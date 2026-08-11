import { NextResponse, type NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { getGoogleOAuthClient, getMicrosoftOAuthClient } from "@/lib/env";
import {
  connectionSetupPath,
  decryptConnectionSetupToken,
  loadActiveConnectionSetupSessionById,
} from "@/lib/integrations/connection-setup";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
} from "@/lib/integrations/credentials";
import { googleWorkspaceAdapter } from "@/lib/integrations/providers/google-workspace";
import { microsoft365Adapter } from "@/lib/integrations/providers/microsoft-365";
import {
  exchangeWorkspaceCode,
  verifyWorkspaceOAuthState,
  type WorkspaceProviderKey,
} from "@/lib/integrations/providers/workspace-oauth";
import { isAccessError, requireClientWorkspaceAccess } from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { refreshPackageDeploymentReadiness } from "@/lib/packages/deployment";
import { enqueueInitialWorkspaceSync } from "@/lib/integrations/connectors/sync-runner";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function redirectAfterOAuth(
  request: NextRequest,
  clientId: string | null,
  outcome: string,
  setupToken?: string | null,
) {
  if (setupToken) {
    const target = new URL(connectionSetupPath(setupToken), request.url);
    target.searchParams.set("workspace", outcome);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(
    new URL(
      clientId
        ? `/partner/clients/${clientId}/setup?workspace=${outcome}`
        : `/partner?workspace=${outcome}`,
      request.url,
    ),
  );
}

export async function completeWorkspaceOAuth(
  request: NextRequest,
  expectedProvider: WorkspaceProviderKey,
) {
  const state = verifyWorkspaceOAuthState(
    request.nextUrl.searchParams.get("state") ?? "",
  );
  if (!state || state.providerKey !== expectedProvider) {
    return redirectAfterOAuth(request, null, "invalid_state");
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return redirectAfterOAuth(request, null, "server_not_configured");

  const { data: connection } = await admin
    .from("integration_connections")
    .select("id, partner_id, client_id, provider:integration_providers!inner(provider_key)")
    .eq("id", state.connectionId)
    .eq("provider.provider_key", expectedProvider)
    .maybeSingle();
  if (!connection) return redirectAfterOAuth(request, null, "connection_missing");

  const setupSession = state.setupSessionId
    ? await loadActiveConnectionSetupSessionById(admin, state.setupSessionId)
    : null;
  const validSetupSession =
    setupSession &&
    setupSession.client_id === connection.client_id &&
    setupSession.partner_id === connection.partner_id &&
    setupSession.allowed_provider_keys.includes(expectedProvider)
      ? setupSession
      : null;
  const setupToken = validSetupSession
    ? decryptConnectionSetupToken(validSetupSession.encrypted_token)
    : null;

  const authState = await getAuthState();
  if (!authState.user && !validSetupSession) {
    return redirectAfterOAuth(request, connection.client_id, "sign_in_required");
  }

  let access = null;
  if (authState.user) {
    try {
      access = await requireClientWorkspaceAccess(
        authState.user.id,
        connection.client_id,
        PARTNER_OPERATOR_ROLES,
      );
    } catch (error) {
      if (isAccessError(error) && !validSetupSession) {
        return redirectAfterOAuth(request, connection.client_id, "not_allowed");
      }
      if (!isAccessError(error)) throw error;
    }
  }

  const fail = async (detail: string, outcome: string) => {
    await admin.from("integration_connections").update({
      status: "needs_attention",
      credential_status: "invalid",
      health_summary: detail,
      last_failure_at: new Date().toISOString(),
      last_checked_at: new Date().toISOString(),
    }).eq("id", connection.id);
    return redirectAfterOAuth(request, connection.client_id, outcome, setupToken);
  };

  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.get("error") || !code) {
    return fail("Authorization was cancelled or denied. Connect again to continue.", "denied");
  }

  const oauthClient =
    expectedProvider === "google_workspace"
      ? getGoogleOAuthClient()
      : getMicrosoftOAuthClient();
  if (!oauthClient) return fail("The platform OAuth application is not configured.", "client_missing");

  const exchanged = await exchangeWorkspaceCode(expectedProvider, oauthClient, code);
  if (!exchanged.ok) return fail(exchanged.error, "exchange_failed");

  const adapter = expectedProvider === "google_workspace"
    ? googleWorkspaceAdapter
    : microsoft365Adapter;
  const test = await adapter.testConnection({
    connectionId: connection.id,
    partnerId: connection.partner_id,
    clientId: connection.client_id,
    credentials: exchanged.credentials,
    config: {},
  });
  if (!test.ok) return fail(test.detail, "verify_failed");

  const stored = encryptProviderCredentials(
    exchanged.credentials as unknown as Record<string, string>,
  );
  const { error: secretError } = await admin.from("integration_secrets").upsert({
    partner_id: connection.partner_id,
    client_id: connection.client_id,
    connection_id: connection.id,
    secret_kind: PROVIDER_CREDENTIALS_KIND,
    encrypted_value: stored.encrypted_value,
    last_four: stored.last_four,
    updated_at: new Date().toISOString(),
  }, { onConflict: "connection_id,secret_kind" });
  if (secretError) return fail("The authorization could not be stored securely.", "store_failed");

  await admin.from("integration_connections").update({
    status: "connected",
    credential_status: "configured",
    health_summary: test.detail,
    external_account_id: test.externalAccountId ?? null,
    external_account_name: test.externalAccountName ?? null,
    connector_version: "1.0.0",
    last_success_at: new Date().toISOString(),
    last_checked_at: new Date().toISOString(),
  }).eq("id", connection.id);

  await refreshPackageDeploymentReadiness(admin, {
    partnerId: connection.partner_id,
    clientId: connection.client_id,
  });
  await enqueueInitialWorkspaceSync(admin, {
    partnerId: connection.partner_id,
    clientId: connection.client_id,
    connectionId: connection.id,
  });

  if (access) {
    await recordAuditEvent({
      actor: { ...access, partnerId: connection.partner_id, clientId: connection.client_id },
      action: "integration.workspace_oauth_completed",
      targetType: "integration_connection",
      targetId: connection.id,
      summary: `${adapter.manifest.name} authorized and verified for ${test.externalAccountName ?? "the client"}.`,
    });
  }

  return redirectAfterOAuth(request, connection.client_id, "connected", setupToken);
}
