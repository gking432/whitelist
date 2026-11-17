import { createHash, randomBytes } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentScope } from "@/lib/agents/types";
import { getGoogleOAuthClient, getMicrosoftOAuthClient } from "@/lib/env";
import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { encryptSecret, decryptSecret } from "@/lib/integrations/secrets";
import { encryptProviderCredentials } from "@/lib/integrations/credentials";
import {
  buildWorkspaceAuthorizationUrl,
  exchangeWorkspaceCode,
  mintWorkspaceAccessToken,
  hasWorkspaceReadGrants,
  type WorkspaceProviderKey,
  type WorkspaceOAuthState,
} from "@/lib/integrations/providers/workspace-oauth";
import {
  enqueueInitialConnectorSync,
  processConnectorSyncJobs,
} from "@/lib/integrations/connectors/sync-runner";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const cookieName = (id: string) => `workspace_read_${id}`;

export async function startReadOnlyOAuth(
  admin: SupabaseClient,
  scope: AgentScope,
  actorId: string,
  providerKey: WorkspaceProviderKey = "google_workspace",
  requestedConnectionId?: string,
) {
  const client = providerKey === "google_workspace" ? getGoogleOAuthClient() : getMicrosoftOAuthClient();
  const label = providerKey === "google_workspace" ? "Google" : "Microsoft";
  if (!client)
    throw new Error(
      `${label} connection setup is pending. Your operator needs to configure the app first.`,
    );
  const { data: provider } = await admin
    .from("integration_providers")
    .select("id")
    .eq("provider_key", providerKey)
    .eq("is_active", true)
    .single()
    .throwOnError();
  // An omitted ID means a new account. Reconnect must name its exact scoped row.
  let connectionId: string | undefined;
  if (requestedConnectionId) {
    const { data: existing } = await admin.from("integration_connections").select("id")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId)
      .eq("provider_id", provider.id).eq("config->>workspace_view_only", "true")
      .eq("id", requestedConnectionId).maybeSingle().throwOnError();
    if (!existing)
      throw new Error("This read-only account is unavailable. Refresh Apps before reconnecting.");
    connectionId = existing.id;
  }
  if (!connectionId) {
    const { data } = await admin
      .from("integration_connections")
      .insert({
        partner_id: scope.partnerId,
        client_id: scope.clientId,
        provider_id: provider.id,
        display_name: providerKey === "google_workspace" ? "Gmail & Google Calendar" : "Outlook & Microsoft Calendar",
        status: "not_connected",
        runtime_mode: "dry_run",
        credential_status: "missing",
        created_by: actorId,
        config: {
          workspace_view_only: true,
          conversation_intake_enabled: false,
          activation_calendar_enabled: false,
        },
        health_summary: `Waiting for ${label} authorization.`,
      })
      .select("id")
      .single()
      .throwOnError();
    connectionId = data.id;
  }
  if (!connectionId) throw new Error("A scoped connection could not be prepared.");
  const verifier = randomBytes(32).toString("base64url"),
    cookie = randomBytes(32).toString("base64url");
  // A fresh attempt supersedes older tabs. Completion also checks the same signed-in actor and browser cookie.
  await admin
    .from("business_connection_oauth_attempts")
    .delete()
    .eq("connection_id", connectionId)
    .eq("actor_id", actorId)
    .throwOnError();
  const { data: attempt } = await admin
    .from("business_connection_oauth_attempts")
    .insert({
      partner_id: scope.partnerId,
      client_id: scope.clientId,
      connection_id: connectionId,
      actor_id: actorId,
      provider_key: providerKey,
      cookie_hash: digest(cookie),
      encrypted_verifier: encryptSecret(verifier),
      expires_at: new Date(Date.now() + 15 * 60000).toISOString(),
    })
    .select("id")
    .single()
    .throwOnError();
  return {
    cookie,
    cookieName: cookieName(attempt.id),
    url: buildWorkspaceAuthorizationUrl(
      providerKey,
      client,
      connectionId,
      undefined,
      {
        attemptId: attempt.id,
        challenge: createHash("sha256").update(verifier).digest("base64url"),
        readOnly: true,
      },
    ),
  };
}

export async function completeReadOnlyOAuth(
  request: NextRequest,
  state: WorkspaceOAuthState,
) {
  const id = state.readOnlyAttemptId!;
  const finish = (outcome: string) => {
    const response = NextResponse.redirect(
      new URL(`/client/apps?connection=${outcome}`, request.url),
    );
    response.cookies.delete(cookieName(id));
    return response;
  };
  if (!["google_workspace", "microsoft_365"].includes(state.providerKey) || !id || state.activationAttemptId) return finish("failed");
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
  const cookie = request.cookies.get(cookieName(id))?.value;
  if (!cookie) return finish("expired");
  const { data: attempt, error } = await admin
    .from("business_connection_oauth_attempts")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", id)
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
    const code = request.nextUrl.searchParams.get("code");
    if (request.nextUrl.searchParams.has("error") || !code)
      return finish("denied");
    const source = await admin.from("integration_connections")
      .select("id,config,provider:integration_providers!inner(provider_key)")
      .eq("id", state.connectionId).eq("partner_id", attempt.partner_id).eq("client_id", attempt.client_id).maybeSingle();
    const sourceProvider = source.data?.provider as unknown as { provider_key: string } | null;
    if (source.error || !source.data || sourceProvider?.provider_key !== state.providerKey ||
        source.data.config?.workspace_view_only !== true) return finish("changed");
    const client = state.providerKey === "google_workspace" ? getGoogleOAuthClient() : getMicrosoftOAuthClient();
    if (!client) return finish("unavailable");
    const result = await exchangeWorkspaceCode(
      state.providerKey,
      client,
      code,
      decryptSecret(attempt.encrypted_verifier),
      true,
    );
    if (!result.ok) return finish("failed");
    // Check actual grants and API access before saving; granular consent can omit a requested permission.
    if (!hasWorkspaceReadGrants(state.providerKey, result.credentials.scope ?? "")) return finish("permissions");
    const token = await mintWorkspaceAccessToken(state.providerKey, result.credentials);
    const headers = { Authorization: `Bearer ${token}` };
    const google = state.providerKey === "google_workspace";
    const [identity, mail, calendar] = await Promise.all([
      fetch(google ? "https://www.googleapis.com/oauth2/v2/userinfo"
        : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", {
        headers, redirect: "error", signal: AbortSignal.timeout(15000),
      }),
      fetch(google ? "https://gmail.googleapis.com/gmail/v1/users/me/profile"
        : "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=1&$select=id", {
        headers, redirect: "error", signal: AbortSignal.timeout(15000),
      }),
      fetch(google ? "https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1"
        : "https://graph.microsoft.com/v1.0/me/calendar/events?$top=1&$select=id", {
        headers, redirect: "error", signal: AbortSignal.timeout(15000),
      }),
    ]);
    if (!identity.ok || !mail.ok || !calendar.ok) return finish("permissions");
    const account = (await identity.json()) as { id?: string; email?: string; mail?: string; userPrincipalName?: string };
    const accountName = google ? account.email : account.mail || account.userPrincipalName;
    if (!account.id || !accountName) return finish("failed");
    const stored = encryptProviderCredentials({
      ...result.credentials,
      accountId: account.id,
      accountName,
    } as unknown as Record<string, string>);
    const saved = await admin.rpc("finish_readonly_workspace_oauth", {
      p_attempt: id,
      p_encrypted: stored.encrypted_value,
      p_last_four: stored.last_four,
      p_account_id: account.id,
      p_account_name: accountName,
    });
    if (saved.error) return finish("changed");
    try {
      await enqueueInitialConnectorSync(admin, {
        partnerId: attempt.partner_id,
        clientId: attempt.client_id,
        connectionId: attempt.connection_id,
        providerKey: state.providerKey,
      });
    } catch {
      return finish("sync_pending");
    }
    after(async () => {
      await processConnectorSyncJobs(4, {
        connectionId: attempt.connection_id,
        readOnly: true,
      });
    });
    return finish("connected");
  } catch {
    return finish("failed");
  } finally {
    await admin
      .from("business_connection_oauth_attempts")
      .delete()
      .eq("id", id)
      .not("consumed_at", "is", null);
  }
}
