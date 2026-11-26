import { createHash, randomBytes } from "node:crypto";
import { startGooglePermissionUpgrade } from "@/lib/connections/oauth";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentScope } from "@/lib/agents/types";
import { getGoogleOAuthClient, getMicrosoftOAuthClient } from "@/lib/env";
import { encryptSecret, decryptSecret } from "@/lib/integrations/secrets";
import { encryptProviderCredentials } from "@/lib/integrations/credentials";
import { ensureProviderConnection } from "@/lib/integrations/connect-provider";
import {
  buildWorkspaceAuthorizationUrl,
  exchangeWorkspaceCode,
  type WorkspaceOAuthState,
} from "@/lib/integrations/providers/workspace-oauth";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { enqueueInitialConnectorSync } from "@/lib/integrations/connectors/sync-runner";
import { applyActivation, readActivationPlan, probeWorkspace } from "./service";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = (id: string) => `business_connect_${id}`;

export async function startActivationOAuth(
  admin: SupabaseClient,
  scope: AgentScope,
  actorId: string,
) {
  const plan = await readActivationPlan(admin, scope);
  if (!plan || plan.status !== "active" || (!plan.email && !plan.bookings))
    throw new Error("Save your assistant setup before connecting an account.");
  if (plan.workspace_provider === "google_workspace") {
    if (!plan.workspace_connection_id) throw new Error("Choose your exact Google account in Apps and grant the selected permissions before connecting team work.");
    const source = await admin.from("integration_connections").select("id,config,provider:integration_providers!inner(provider_key)")
      .eq("id", plan.workspace_connection_id).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).maybeSingle();
    if (source.error || !source.data || (source.data.provider as unknown as { provider_key: string })?.provider_key !== "google_workspace")
      throw new Error("The exact selected Google account is unavailable.");
    if (source.data.config?.workspace_view_only === true)
      return startGooglePermissionUpgrade(admin, scope, actorId, source.data.id, [...(plan.bookings ? ["calendar.write" as const] : []), ...(plan.email ? ["email.send" as const] : [])]);
  }
  const client =
    plan.workspace_provider === "google_workspace"
      ? getGoogleOAuthClient()
      : getMicrosoftOAuthClient();
  if (!client)
    throw new Error(
      "Your operator is still preparing this connection. No account details are needed from you yet.",
    );
  if (!plan.workspace_connection_id)
    await ensureProviderConnection(
      admin,
      { ...scope, createdBy: actorId },
      plan.workspace_provider,
    );
  const selected = await applyActivation(admin, scope, plan.revision, null);
  const connectionId = selected?.workspace_connection_id;
  if (!connectionId)
    throw new Error("The selected connection could not be prepared.");
  const verifier = randomBytes(32).toString("base64url"),
    cookie = randomBytes(32).toString("base64url");
  const { data, error } = await admin
    .from("business_activation_oauth_attempts")
    .insert({
      partner_id: scope.partnerId,
      client_id: scope.clientId,
      connection_id: connectionId,
      actor_id: actorId,
      provider_key: plan.workspace_provider,
      plan_revision: plan.revision,
      cookie_hash: digest(cookie),
      encrypted_verifier: encryptSecret(verifier),
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    })
    .select("id")
    .single();
  if (error) throw new Error("Authorization could not be started.");
  return {
    cookie,
    cookieName: cookieName(data.id),
    url: buildWorkspaceAuthorizationUrl(
      plan.workspace_provider,
      client,
      connectionId,
      undefined,
      {
        attemptId: data.id,
        challenge: createHash("sha256").update(verifier).digest("base64url"),
      },
    ),
  };
}

export async function completeActivationOAuth(
  request: NextRequest,
  state: WorkspaceOAuthState,
) {
  const attemptId = state.activationAttemptId!;
  const finish = (outcome: string) => {
    const response = NextResponse.redirect(
      new URL(`/client/activate?connection=${outcome}`, request.url),
    );
    response.cookies.delete(cookieName(attemptId));
    return response;
  };
  const admin = createSupabaseAdminClient();
  if (!admin) return finish("unavailable");
  const { user } = await getAuthState();
  const portal = user ? await loadClientPortal() : null;
  if (
    !user ||
    portal?.kind !== "ok" ||
    !canWriteBusinessWorkspace(portal.access) ||
    portal.access.isImpersonating
  )
    return finish("sign_in_required");
  const cookie = request.cookies.get(cookieName(attemptId))?.value;
  if (!cookie) return finish("expired");
  // Atomic, browser-bound, one-time consumption; failures preserve a prior working connection.
  const { data: attempt, error } = await admin
    .from("business_activation_oauth_attempts")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", attemptId)
    .eq("actor_id", user.id)
    .eq("partner_id", portal.client.partner_id)
    .eq("client_id", portal.client.id)
    .eq("connection_id", state.connectionId)
    .eq("provider_key", state.providerKey)
    .eq("cookie_hash", digest(cookie))
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("*")
    .maybeSingle();
  if (error || !attempt) return finish("expired");
  try {
    if (request.nextUrl.searchParams.has("error")) return finish("denied");
    const code = request.nextUrl.searchParams.get("code");
    if (!code) return finish("denied");
    const scope = {
      partnerId: attempt.partner_id,
      clientId: attempt.client_id,
    };
    const plan = await readActivationPlan(admin, scope);
    if (
      !plan ||
      plan.revision !== attempt.plan_revision ||
      plan.status !== "active"
    )
      return finish("changed");
    const client =
      state.providerKey === "google_workspace"
        ? getGoogleOAuthClient()
        : getMicrosoftOAuthClient();
    if (!client) return finish("unavailable");
    const exchange = await exchangeWorkspaceCode(
      state.providerKey,
      client,
      code,
      decryptSecret(attempt.encrypted_verifier),
    );
    if (!exchange.ok) return finish("failed");
    const checked = await probeWorkspace(
      state.providerKey,
      exchange.credentials,
    );
    const prior = await admin
      .from("integration_connections")
      .select("external_account_id")
      .eq("id", attempt.connection_id)
      .eq("partner_id", attempt.partner_id)
      .eq("client_id", attempt.client_id)
      .single()
      .throwOnError();
    if (
      prior.data.external_account_id &&
      prior.data.external_account_id !== checked.accountId
    )
      return finish("wrong_account");
    if ((plan.email && !checked.email) || (plan.bookings && !checked.calendar))
      return finish("permissions");
    const stored = encryptProviderCredentials(
      exchange.credentials as unknown as Record<string, string>,
    );
    const result = await admin.rpc("finish_activation_oauth", {
      p_attempt: attemptId,
      p_encrypted: stored.encrypted_value,
      p_last_four: stored.last_four,
      p_account_id: checked.accountId,
      p_account_name: checked.accountName,
      p_email: checked.email,
      p_calendar: checked.calendar,
    });
    if (result.error) return finish("changed");
    try {
      await enqueueInitialConnectorSync(admin, {
        ...scope,
        connectionId: attempt.connection_id,
        providerKey: state.providerKey,
      });
    } catch {
      return finish("sync_pending");
    }
    return finish("connected");
  } catch {
    return finish("failed");
  } finally {
    await admin
      .from("business_activation_oauth_attempts")
      .delete()
      .eq("id", attemptId)
      .not("consumed_at", "is", null);
  }
}
