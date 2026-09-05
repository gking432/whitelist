import { NextResponse, type NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { getJobberOAuthClient } from "@/lib/env";
import { connectionSetupPath, decryptConnectionSetupToken, loadActiveConnectionSetupSessionById } from "@/lib/integrations/connection-setup";
import { enqueueInitialConnectorSync } from "@/lib/integrations/connectors/sync-runner";
import { encryptProviderCredentials, PROVIDER_CREDENTIALS_KIND } from "@/lib/integrations/credentials";
import { jobberAdapter } from "@/lib/integrations/providers/jobber";
import { exchangeJobberCode, verifyJobberState } from "@/lib/integrations/providers/jobber-oauth";
import { isAccessError, requireClientWorkspaceAccess } from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { refreshPackageDeploymentReadiness } from "@/lib/packages/deployment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function finish(request: NextRequest, clientId: string | null, outcome: string, setupToken?: string | null) {
  if (setupToken) {
    const target = new URL(connectionSetupPath(setupToken), request.url);
    target.searchParams.set("workspace", outcome);
    return NextResponse.redirect(target);
  }
  return NextResponse.redirect(new URL(clientId ? `/partner/clients/${clientId}/setup?workspace=${outcome}` : `/partner?workspace=${outcome}`, request.url));
}

export async function GET(request: NextRequest) {
  const state = verifyJobberState(request.nextUrl.searchParams.get("state") ?? "");
  if (!state) return finish(request, null, "invalid_state");
  const admin = createSupabaseAdminClient();
  if (!admin) return finish(request, null, "server_not_configured");
  const { data: connection } = await admin.from("integration_connections")
    .select("id, partner_id, client_id, provider:integration_providers!inner(provider_key)")
    .eq("id", state.connectionId).eq("provider.provider_key", "jobber").maybeSingle();
  if (!connection) return finish(request, null, "connection_missing");

  const session = state.setupSessionId ? await loadActiveConnectionSetupSessionById(admin, state.setupSessionId) : null;
  const validSession = session && session.client_id === connection.client_id && session.partner_id === connection.partner_id && session.allowed_provider_keys.includes("jobber") ? session : null;
  const setupToken = validSession ? decryptConnectionSetupToken(validSession.encrypted_token) : null;
  const auth = await getAuthState();
  if (!auth.user && !validSession) return finish(request, connection.client_id, "sign_in_required");
  let access = null;
  if (auth.user) {
    try { access = await requireClientWorkspaceAccess(auth.user.id, connection.client_id, PARTNER_OPERATOR_ROLES); }
    catch (error) {
      if (isAccessError(error) && !validSession) return finish(request, connection.client_id, "not_allowed");
      if (!isAccessError(error)) throw error;
    }
  }
  const fail = async (detail: string, outcome: string) => {
    await admin.from("integration_connections").update({ status: "needs_attention", credential_status: "invalid", health_summary: detail, last_failure_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", connection.id);
    return finish(request, connection.client_id, outcome, setupToken);
  };
  const code = request.nextUrl.searchParams.get("code");
  if (!code || request.nextUrl.searchParams.get("error")) return fail("Jobber authorization was cancelled or denied.", "denied");
  const oauthClient = getJobberOAuthClient();
  if (!oauthClient) return fail("The platform Jobber app is not configured.", "client_missing");
  let credentials;
  try { credentials = await exchangeJobberCode(oauthClient, code, state.codeVerifier); }
  catch (error) { return fail(error instanceof Error ? error.message : "Jobber token exchange failed.", "exchange_failed"); }
  const test = await jobberAdapter.testConnection({ connectionId: connection.id, partnerId: connection.partner_id, clientId: connection.client_id, credentials, config: {} });
  if (!test.ok) return fail(test.detail, "verify_failed");
  const stored = encryptProviderCredentials(credentials as unknown as Record<string, string>);
  const { error: secretError } = await admin.from("integration_secrets").upsert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, secret_kind: PROVIDER_CREDENTIALS_KIND, encrypted_value: stored.encrypted_value, last_four: stored.last_four, updated_at: new Date().toISOString() }, { onConflict: "connection_id,secret_kind" });
  if (secretError) return fail("Jobber credentials could not be stored securely.", "store_failed");
  await admin.from("integration_connections").update({ status: "connected", credential_status: "configured", health_summary: test.detail, external_account_id: test.externalAccountId ?? null, external_account_name: test.externalAccountName ?? null, connector_version: "1.0.0", last_success_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", connection.id);
  await enqueueInitialConnectorSync(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, providerKey: "jobber" });
  await refreshPackageDeploymentReadiness(admin, { partnerId: connection.partner_id, clientId: connection.client_id });
  if (access) await recordAuditEvent({ actor: { ...access, partnerId: connection.partner_id, clientId: connection.client_id }, action: "integration.jobber_oauth_completed", targetType: "integration_connection", targetId: connection.id, summary: `Jobber authorized for ${test.externalAccountName ?? "the client"}.` });
  return finish(request, connection.client_id, "connected", setupToken);
}
