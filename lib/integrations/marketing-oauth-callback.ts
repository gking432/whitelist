import { NextResponse, type NextRequest } from "next/server";

import { getAuthState } from "@/lib/auth/session";
import { getAppUrl, getGoogleAdsDeveloperToken, getGoogleOAuthClient, getMetaOAuthClient, getPodiumOAuthClient } from "@/lib/env";
import { connectionSetupPath, decryptConnectionSetupToken, loadActiveConnectionSetupSessionById } from "@/lib/integrations/connection-setup";
import { enqueueInitialConnectorSync } from "@/lib/integrations/connectors/sync-runner";
import { encryptProviderCredentials, PROVIDER_CREDENTIALS_KIND } from "@/lib/integrations/credentials";
import { googleAdsAdapter } from "@/lib/integrations/providers/google-ads";
import { googleBusinessProfileAdapter } from "@/lib/integrations/providers/google-business-profile";
import { exchangeGoogleMarketingCode, exchangeMetaCode, exchangePodiumCode, verifyMarketingOAuthState, type MarketingOAuthProviderKey } from "@/lib/integrations/providers/marketing-oauth";
import { metaAdapter } from "@/lib/integrations/providers/meta";
import { podiumAdapter } from "@/lib/integrations/providers/podium";
import { isAccessError, requireClientWorkspaceAccess } from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { refreshPackageDeploymentReadiness } from "@/lib/packages/deployment";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function finish(request: NextRequest, clientId: string | null, outcome: string, setupToken?: string | null) { if (setupToken) { const target = new URL(connectionSetupPath(setupToken), request.url); target.searchParams.set("marketing", outcome); return NextResponse.redirect(target); } return NextResponse.redirect(new URL(clientId ? `/partner/clients/${clientId}/setup?marketing=${outcome}` : `/partner?marketing=${outcome}`, request.url)); }

export async function completeMarketingOAuth(request: NextRequest, expectedProvider: MarketingOAuthProviderKey) {
  const state = verifyMarketingOAuthState(request.nextUrl.searchParams.get("state") ?? ""); if (!state || state.providerKey !== expectedProvider) return finish(request, null, "invalid_state");
  const admin = createSupabaseAdminClient(); if (!admin) return finish(request, null, "server_not_configured");
  const { data: connection } = await admin.from("integration_connections").select("id, partner_id, client_id, provider:integration_providers!inner(provider_key)").eq("id", state.connectionId).eq("provider.provider_key", expectedProvider).maybeSingle(); if (!connection) return finish(request, null, "connection_missing");
  const session = state.setupSessionId ? await loadActiveConnectionSetupSessionById(admin, state.setupSessionId) : null; const validSession = session && session.client_id === connection.client_id && session.partner_id === connection.partner_id && session.allowed_provider_keys.includes(expectedProvider) ? session : null; const setupToken = validSession ? decryptConnectionSetupToken(validSession.encrypted_token) : null;
  const auth = await getAuthState(); if (!auth.user && !validSession) return finish(request, connection.client_id, "sign_in_required");
  if (auth.user && !validSession) { try { await requireClientWorkspaceAccess(auth.user.id, connection.client_id, PARTNER_OPERATOR_ROLES); } catch (error) { if (isAccessError(error)) return finish(request, connection.client_id, "not_allowed"); throw error; } }
  const fail = async (detail: string, outcome: string) => { await admin.from("integration_connections").update({ status: "needs_attention", credential_status: "invalid", health_summary: detail, last_failure_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", connection.id); return finish(request, connection.client_id, outcome, setupToken); };
  const code = request.nextUrl.searchParams.get("code"); if (!code || request.nextUrl.searchParams.get("error")) return fail("Authorization was cancelled or denied.", "denied");
  const client = expectedProvider === "meta" ? getMetaOAuthClient() : expectedProvider === "podium" ? getPodiumOAuthClient() : getGoogleOAuthClient(); if (!client) return fail("The platform provider application is not configured.", "client_missing");
  try {
    const credentials = expectedProvider === "meta" ? await exchangeMetaCode(client, code) : expectedProvider === "podium" ? await exchangePodiumCode(client, code) : await exchangeGoogleMarketingCode(expectedProvider, client, code, getGoogleAdsDeveloperToken() ?? undefined);
    const adapter = expectedProvider === "meta" ? metaAdapter : expectedProvider === "podium" ? podiumAdapter : expectedProvider === "google_ads" ? googleAdsAdapter : googleBusinessProfileAdapter;
    const test = await adapter.testConnection({ connectionId: connection.id, partnerId: connection.partner_id, clientId: connection.client_id, credentials: credentials as never, config: {} }); if (!test.ok) return fail(test.detail, "verify_failed");
    const stored = encryptProviderCredentials(credentials as unknown as Record<string, string>); const { error } = await admin.from("integration_secrets").upsert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, secret_kind: PROVIDER_CREDENTIALS_KIND, encrypted_value: stored.encrypted_value, last_four: stored.last_four, updated_at: new Date().toISOString() }, { onConflict: "connection_id,secret_kind" }); if (error) return fail("The authorization could not be stored securely.", "store_failed");
    let hookDetail = "";
    if (expectedProvider === "meta" && adapter.registerWebhooks && getAppUrl().startsWith("https://")) { const registrations = await adapter.registerWebhooks({ connectionId: connection.id, partnerId: connection.partner_id, clientId: connection.client_id, credentials: credentials as never, config: {} }, `${getAppUrl().replace(/\/$/, "")}/api/integrations/inbound/meta`); for (const registration of registrations) await admin.from("integration_webhook_registrations").upsert({ partner_id: connection.partner_id, client_id: connection.client_id, connection_id: connection.id, event_type: registration.eventType, endpoint_path: new URL(registration.endpointUrl).pathname, external_registration_id: registration.externalRegistrationId ?? null, status: "active", last_verified_at: new Date().toISOString(), metadata: registration.metadata ?? {} }, { onConflict: "connection_id,event_type,endpoint_path" }); hookDetail = " Live Lead Ads subscription activated."; }
    await admin.from("integration_connections").update({ status: "connected", credential_status: "configured", health_summary: `${test.detail}${hookDetail}`, external_account_id: test.externalAccountId ?? null, external_account_name: test.externalAccountName ?? null, connector_version: "1.0.0", last_success_at: new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", connection.id);
    await enqueueInitialConnectorSync(admin, { partnerId: connection.partner_id, clientId: connection.client_id, connectionId: connection.id, providerKey: expectedProvider }); await refreshPackageDeploymentReadiness(admin, { partnerId: connection.partner_id, clientId: connection.client_id }); return finish(request, connection.client_id, "connected", setupToken);
  } catch (error) { return fail(error instanceof Error ? error.message : "Provider authorization failed.", "exchange_failed"); }
}
