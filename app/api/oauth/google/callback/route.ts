import { NextResponse, type NextRequest } from "next/server";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
  readProviderCredentials,
} from "@/lib/integrations/credentials";
import {
  exchangeCodeForTokens,
  testCalendarAccess,
  verifyOAuthState,
  type GoogleCalendarCredentials,
  type GoogleOAuthClient,
} from "@/lib/integrations/providers/google-calendar";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Google OAuth callback for the pilot stack. Google redirects the partner's
// browser here after the consent screen. Two independent checks gate the
// write: the HMAC-signed state (proves Northstar started this exact flow for
// this exact connection, within 15 minutes) and the signed-in user's own
// permission to manage that client's integrations.

export const dynamic = "force-dynamic";

function redirectToPilot(
  request: NextRequest,
  clientId: string | null,
  outcome: string,
): NextResponse {
  const target = clientId
    ? `/partner/clients/${clientId}/pilot?google=${outcome}`
    : `/partner?google=${outcome}`;

  return NextResponse.redirect(new URL(target, request.url));
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const code = params.get("code");
  const oauthError = params.get("error");

  const connectionId = verifyOAuthState(state);

  if (!connectionId) {
    return redirectToPilot(request, null, "invalid_state");
  }

  const admin = createSupabaseAdminClient();

  if (!admin) {
    return redirectToPilot(request, null, "server_not_configured");
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, provider:integration_providers!inner(provider_key)",
    )
    .eq("id", connectionId)
    .eq("provider.provider_key", "google_calendar")
    .maybeSingle();

  if (!connection) {
    return redirectToPilot(request, null, "connection_missing");
  }

  const clientId: string = connection.client_id;

  // The person completing the flow must themselves be allowed to manage
  // this client's integrations — the signed state alone is not enough.
  const authState = await getAuthState();

  if (!authState.user) {
    return redirectToPilot(request, clientId, "sign_in_required");
  }

  let access;

  try {
    access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );
  } catch (error) {
    if (isAccessError(error)) {
      return redirectToPilot(request, clientId, "not_allowed");
    }

    throw error;
  }

  const failConnection = async (summary: string, outcome: string) => {
    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        credential_status: "invalid",
        health_summary: summary,
        last_failure_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    return redirectToPilot(request, clientId, outcome);
  };

  if (oauthError || !code) {
    return failConnection(
      "Google authorization was cancelled or denied. Click Connect to try again.",
      "denied",
    );
  }

  const oauthClient = await readProviderCredentials<GoogleOAuthClient>(
    admin,
    connectionId,
  );

  if (!oauthClient?.clientId || !oauthClient.clientSecret) {
    return failConnection(
      "The stored OAuth client is missing. Enter the client ID and secret again.",
      "client_missing",
    );
  }

  const tokens = await exchangeCodeForTokens(oauthClient, code);

  if ("error" in tokens) {
    return failConnection(tokens.error, "exchange_failed");
  }

  const credentials: GoogleCalendarCredentials = {
    clientId: oauthClient.clientId,
    clientSecret: oauthClient.clientSecret,
    refreshToken: tokens.refreshToken,
  };

  const { encrypted_value, last_four } = encryptProviderCredentials(
    credentials as unknown as Record<string, string>,
  );

  const { error: secretError } = await admin.from("integration_secrets").upsert(
    {
      partner_id: connection.partner_id,
      client_id: clientId,
      connection_id: connectionId,
      secret_kind: PROVIDER_CREDENTIALS_KIND,
      encrypted_value,
      last_four,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,secret_kind" },
  );

  if (secretError) {
    return failConnection(
      "The Google credentials could not be stored. Try connecting again.",
      "store_failed",
    );
  }

  // Immediately prove the grant works with a real availability read.
  const test = await testCalendarAccess(credentials);

  await admin
    .from("integration_connections")
    .update(
      test.ok
        ? {
            status: "connected",
            credential_status: "configured",
            health_summary: test.detail,
            last_success_at: new Date().toISOString(),
          }
        : {
            status: "needs_attention",
            credential_status: "configured",
            health_summary: test.detail,
            last_failure_at: new Date().toISOString(),
          },
    )
    .eq("id", connectionId);

  await recordAuditEvent({
    actor: { ...access, partnerId: connection.partner_id, clientId },
    action: "integration.pilot_oauth_completed",
    targetType: "integration_connection",
    targetId: connectionId,
    summary: test.ok
      ? "Google Calendar authorized and verified with a live availability check."
      : `Google Calendar authorized, but the first availability check failed: ${test.detail}`,
  });

  return redirectToPilot(request, clientId, test.ok ? "connected" : "verify_failed");
}
