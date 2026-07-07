"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
  readProviderCredentials,
} from "@/lib/integrations/credentials";
import { isPilotProviderKey, PILOT_PROVIDERS } from "@/lib/integrations/pilot";
import {
  buildAuthorizationUrl,
  testCalendarAccess,
  type GoogleCalendarCredentials,
} from "@/lib/integrations/providers/google-calendar";
import {
  testEmailConnection,
  type EmailCredentials,
} from "@/lib/integrations/providers/email";
import {
  testHubSpotConnection,
  type HubSpotCredentials,
} from "@/lib/integrations/providers/hubspot";
import {
  testTwilioConnection,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { isSecretsEncryptionConfigured } from "@/lib/integrations/secrets";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Server actions for the Pilot Stack screen. Credentials arrive here once,
// are verified against the real provider API, stored encrypted, and never
// returned to the browser again. All reads of stored credentials go through
// the service-role client after an explicit permission check.

function deniedState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage integrations for this client."
          : "Integrations are unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function loadPilotContext(userId: string, clientId: string) {
  const access = await requireClientWorkspaceAccess(
    userId,
    clientId,
    PARTNER_OPERATOR_ROLES,
  );

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) {
    return null;
  }

  return { access, supabase };
}

// Finds this client's connection for a pilot provider, creating it on first
// connect. One connection per pilot provider per client keeps the screen
// simple and the workflow lookups unambiguous.
async function ensurePilotConnection(input: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  partnerId: string;
  clientId: string;
  userId: string;
  providerKey: string;
  displayName: string;
}) {
  const { supabase } = input;

  const { data: provider } = await supabase
    .from("integration_providers")
    .select("id, provider_key, display_name")
    .eq("provider_key", input.providerKey)
    .eq("is_active", true)
    .maybeSingle();

  if (!provider) {
    return { error: "This provider is not available yet. Apply the latest database migrations." } as const;
  }

  const { data: existing } = await supabase
    .from("integration_connections")
    .select("id")
    .eq("client_id", input.clientId)
    .eq("partner_id", input.partnerId)
    .eq("provider_id", provider.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { connectionId: existing.id as string, created: false } as const;
  }

  const { data: created, error: insertError } = await supabase
    .from("integration_connections")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      provider_id: provider.id,
      display_name: input.displayName,
      status: "not_connected",
      // New pilot connections start in dry run: every outbound action is
      // recorded, nothing real is sent until someone flips it to live.
      runtime_mode: "dry_run",
      credential_status: "missing",
      config: {},
      health_summary: "Waiting for credentials.",
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (insertError || !created) {
    return { error: "The connection could not be created. Try again." } as const;
  }

  return { connectionId: created.id as string, created: true } as const;
}

async function storeCredentials(input: {
  supabase: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
  partnerId: string;
  clientId: string;
  connectionId: string;
  credentials: Record<string, string>;
}) {
  const { encrypted_value, last_four } = encryptProviderCredentials(
    input.credentials,
  );

  const { error } = await input.supabase.from("integration_secrets").upsert(
    {
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: input.connectionId,
      secret_kind: PROVIDER_CREDENTIALS_KIND,
      encrypted_value,
      last_four,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "connection_id,secret_kind" },
  );

  return !error;
}

// Connect HubSpot or Twilio: verify the pasted credentials against the real
// provider API first, store them only if the check passes.
export async function connectPilotProvider(
  clientId: string,
  providerKey: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  if (!isPilotProviderKey(providerKey) || providerKey === "google_calendar") {
    return { status: "error", message: "Unknown pilot provider." };
  }

  if (!isSecretsEncryptionConfigured()) {
    return {
      status: "error",
      message:
        "Secret storage is not configured. Set SECRETS_ENCRYPTION_KEY on the server first (see docs/13).",
    };
  }

  const meta = PILOT_PROVIDERS[providerKey];
  const credentials: Record<string, string> = {};
  const fieldErrors: Record<string, string> = {};

  for (const field of meta.fields) {
    const value = String(formData.get(field.name) ?? "").trim();

    if (!value && !field.optional) {
      fieldErrors[field.name] = `${field.label} is required.`;
    } else if (value) {
      credentials[field.name] = value;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fill in the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    const context = await loadPilotContext(authState.user.id, clientId);

    if (!context) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { access, supabase } = context;

    // Live check against the provider before anything is stored, so a typo
    // is caught immediately instead of failing silently later.
    const test =
      providerKey === "hubspot"
        ? await testHubSpotConnection(
            credentials as unknown as HubSpotCredentials,
          )
        : providerKey === "resend"
          ? await testEmailConnection(
              credentials as unknown as EmailCredentials,
            )
          : await testTwilioConnection(
              credentials as unknown as TwilioCredentials,
            );

    if (!test.ok) {
      return {
        status: "error",
        message: `The credentials did not work: ${test.detail}`,
      };
    }

    const ensured = await ensurePilotConnection({
      supabase,
      partnerId: access.partnerId!,
      clientId,
      userId: access.userId,
      providerKey,
      displayName: meta.title,
    });

    if ("error" in ensured) {
      return { status: "error", message: ensured.error };
    }

    const stored = await storeCredentials({
      supabase,
      partnerId: access.partnerId!,
      clientId,
      connectionId: ensured.connectionId,
      credentials,
    });

    if (!stored) {
      return {
        status: "error",
        message: "The credentials could not be stored. Try again.",
      };
    }

    await supabase
      .from("integration_connections")
      .update({
        status: "connected",
        credential_status: "configured",
        health_summary: test.detail,
        last_success_at: new Date().toISOString(),
      })
      .eq("id", ensured.connectionId);

    await recordAuditEvent({
      actor: access,
      action: "integration.pilot_connected",
      targetType: "integration_connection",
      targetId: ensured.connectionId,
      summary: `Connected ${meta.title} for the pilot stack (credentials verified).`,
      afterSnapshot: {
        provider_key: providerKey,
        status: "connected",
        credential_status: "configured",
      },
    });

    revalidatePath(`/partner/clients/${clientId}/setup`);
    revalidatePath(`/partner/clients/${clientId}/integrations`);

    return { status: "success", message: test.detail };
  } catch (error) {
    return deniedState(error);
  }
}

// Google is a two-step connect: store the partner's OAuth client, then send
// the browser to Google's consent screen. The callback route finishes the
// job by storing the refresh token.
export async function startGoogleConnect(
  clientId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  if (!isSecretsEncryptionConfigured()) {
    return {
      status: "error",
      message:
        "Secret storage is not configured. Set SECRETS_ENCRYPTION_KEY on the server first (see docs/13).",
    };
  }

  const oauthClientId = String(formData.get("clientId") ?? "").trim();
  const oauthClientSecret = String(formData.get("clientSecret") ?? "").trim();
  const fieldErrors: Record<string, string> = {};

  if (!oauthClientId) {
    fieldErrors.clientId = "OAuth client ID is required.";
  }

  if (!oauthClientSecret) {
    fieldErrors.clientSecret = "OAuth client secret is required.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fill in the highlighted fields and try again.",
      fieldErrors,
    };
  }

  let authorizationUrl: string;

  try {
    const context = await loadPilotContext(authState.user.id, clientId);

    if (!context) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { access, supabase } = context;
    const meta = PILOT_PROVIDERS.google_calendar;

    const ensured = await ensurePilotConnection({
      supabase,
      partnerId: access.partnerId!,
      clientId,
      userId: access.userId,
      providerKey: "google_calendar",
      displayName: meta.title,
    });

    if ("error" in ensured) {
      return { status: "error", message: ensured.error };
    }

    const stored = await storeCredentials({
      supabase,
      partnerId: access.partnerId!,
      clientId,
      connectionId: ensured.connectionId,
      credentials: { clientId: oauthClientId, clientSecret: oauthClientSecret },
    });

    if (!stored) {
      return {
        status: "error",
        message: "The OAuth client could not be stored. Try again.",
      };
    }

    await supabase
      .from("integration_connections")
      .update({
        credential_status: "rotating",
        health_summary:
          "OAuth client saved. Waiting for Google authorization to finish.",
      })
      .eq("id", ensured.connectionId);

    await recordAuditEvent({
      actor: access,
      action: "integration.pilot_oauth_started",
      targetType: "integration_connection",
      targetId: ensured.connectionId,
      summary: "Started Google Calendar authorization.",
    });

    authorizationUrl = buildAuthorizationUrl(
      { clientId: oauthClientId, clientSecret: oauthClientSecret },
      ensured.connectionId,
    );
  } catch (error) {
    return deniedState(error);
  }

  // Outside the try/catch: redirect() works by throwing.
  redirect(authorizationUrl);
}

// Re-test a stored connection on demand. Reads the encrypted credentials via
// the service-role client (browser roles cannot see them) after the same
// permission check every management action uses.
export async function testPilotConnection(
  clientId: string,
  connectionId: string,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  try {
    const context = await loadPilotContext(authState.user.id, clientId);

    if (!context) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { access, supabase } = context;

    const { data: connection } = await supabase
      .from("integration_connections")
      .select(
        "id, display_name, provider:integration_providers!inner(provider_key)",
      )
      .eq("id", connectionId)
      .eq("client_id", clientId)
      .eq("partner_id", access.partnerId!)
      .maybeSingle();

    const providerKey = (
      connection as { provider?: { provider_key?: string } } | null
    )?.provider?.provider_key;

    if (!connection || !providerKey || !isPilotProviderKey(providerKey)) {
      return { status: "error", message: "Connection not found." };
    }

    const admin = createSupabaseAdminClient();

    if (!admin) {
      return {
        status: "error",
        message: "The server is not configured to read stored credentials.",
      };
    }

    let result: { ok: boolean; detail: string };

    if (providerKey === "hubspot") {
      const credentials = await readProviderCredentials<HubSpotCredentials>(
        admin,
        connectionId,
      );

      result = credentials?.privateAppToken
        ? await testHubSpotConnection(credentials)
        : { ok: false, detail: "No credentials stored yet. Connect first." };
    } else if (providerKey === "twilio") {
      const credentials = await readProviderCredentials<TwilioCredentials>(
        admin,
        connectionId,
      );

      result =
        credentials?.accountSid && credentials.authToken
          ? await testTwilioConnection(credentials)
          : { ok: false, detail: "No credentials stored yet. Connect first." };
    } else if (providerKey === "resend") {
      const credentials = await readProviderCredentials<EmailCredentials>(
        admin,
        connectionId,
      );

      result =
        credentials?.apiKey && credentials.fromEmail
          ? await testEmailConnection(credentials)
          : { ok: false, detail: "No credentials stored yet. Connect first." };
    } else {
      const credentials =
        await readProviderCredentials<GoogleCalendarCredentials>(
          admin,
          connectionId,
        );

      if (!credentials?.clientId || !credentials.clientSecret) {
        result = {
          ok: false,
          detail: "No OAuth client stored yet. Connect first.",
        };
      } else if (!credentials.refreshToken) {
        result = {
          ok: false,
          detail:
            "Google authorization was started but not finished. Click Connect again and complete the Google consent screen.",
        };
      } else {
        result = await testCalendarAccess(credentials);
      }
    }

    await supabase
      .from("integration_connections")
      .update(
        result.ok
          ? {
              status: "connected",
              health_summary: result.detail,
              last_success_at: new Date().toISOString(),
            }
          : {
              status: "needs_attention",
              health_summary: result.detail,
              last_failure_at: new Date().toISOString(),
            },
      )
      .eq("id", connectionId);

    revalidatePath(`/partner/clients/${clientId}/setup`);

    return {
      status: result.ok ? "success" : "error",
      message: result.detail,
    };
  } catch (error) {
    return deniedState(error);
  }
}

// Flip a pilot connection between dry run and live. Live is the only mode in
// which anything real leaves Northstar, so the change is always audited.
export async function setPilotLiveMode(
  clientId: string,
  connectionId: string,
  live: boolean,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  try {
    const context = await loadPilotContext(authState.user.id, clientId);

    if (!context) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { access, supabase } = context;

    const { data: connection } = await supabase
      .from("integration_connections")
      .select("id, display_name, runtime_mode, status")
      .eq("id", connectionId)
      .eq("client_id", clientId)
      .eq("partner_id", access.partnerId!)
      .maybeSingle();

    if (!connection) {
      return { status: "error", message: "Connection not found." };
    }

    if (live && connection.status !== "connected") {
      return {
        status: "error",
        message:
          "Connect and test this integration before switching it to live.",
      };
    }

    const nextMode = live ? "live" : "dry_run";

    const { error } = await supabase
      .from("integration_connections")
      .update({ runtime_mode: nextMode })
      .eq("id", connectionId);

    if (error) {
      return { status: "error", message: "The mode could not be changed." };
    }

    await recordAuditEvent({
      actor: access,
      action: "integration.runtime_mode_changed",
      targetType: "integration_connection",
      targetId: connectionId,
      summary: `Switched "${connection.display_name}" to ${live ? "live" : "dry run"} mode.`,
      beforeSnapshot: { runtime_mode: connection.runtime_mode },
      afterSnapshot: { runtime_mode: nextMode },
    });

    revalidatePath(`/partner/clients/${clientId}/setup`);
    revalidatePath(`/partner/clients/${clientId}/integrations`);

    return {
      status: "success",
      message: live
        ? "This connection is now LIVE — approved actions will really send."
        : "Back to dry run. Actions are recorded but nothing real is sent.",
    };
  } catch (error) {
    return deniedState(error);
  }
}
