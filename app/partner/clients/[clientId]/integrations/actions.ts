"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { RUNTIME_MODES } from "@/lib/clients/constants";
import type { FormState } from "@/lib/forms/state";
import {
  encryptSecret,
  generateWebhookToken,
  isSecretsEncryptionConfigured,
  secretLastFour,
} from "@/lib/integrations/secrets";
import {
  OUTBOUND_WEBHOOK_PROVIDER_KEY,
  inboundWebhookPath,
  isSelfServiceConnectionProvider,
  isTokenInboundProvider,
  type IntegrationProviderRecord,
} from "@/lib/integrations/types";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type ConnectionFormState = FormState & {
  // One-time credential display. Only ever populated in the immediate
  // response to the user who created/rotated it; never stored in plaintext.
  oneTimeToken?: string;
  connectionId?: string;
  endpointPath?: string;
};

function deniedState(error: unknown): ConnectionFormState {
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

export async function createIntegrationConnection(
  clientId: string,
  _previousState: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  const providerId = String(formData.get("provider_id") ?? "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const runtimeMode = String(formData.get("runtime_mode") ?? "sandbox");
  const outboundUrl = String(formData.get("outbound_url") ?? "").trim();

  const fieldErrors: Record<string, string> = {};

  if (!providerId) {
    fieldErrors.provider_id = "Choose a provider.";
  }

  if (!displayName) {
    fieldErrors.display_name = "Give this connection a name.";
  }

  if (!RUNTIME_MODES.includes(runtimeMode as never)) {
    fieldErrors.runtime_mode = "Choose a runtime mode.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { data: provider, error: providerError } = await supabase
      .from("integration_providers")
      .select("*")
      .eq("id", providerId)
      .eq("is_active", true)
      .maybeSingle();

    if (providerError || !provider) {
      return {
        status: "error",
        message: "The selected provider is not available.",
        fieldErrors: { provider_id: "Choose a valid provider." },
      };
    }

    const providerRecord = provider as IntegrationProviderRecord;
    if (!isSelfServiceConnectionProvider(providerRecord.provider_key)) {
      return {
        status: "error",
        message:
          "Client-owned accounts must be authorized through a secure setup link.",
        fieldErrors: {
          provider_id: "Open Connection Setup and send the client a secure link.",
        },
      };
    }

    const isInboundWebhook = isTokenInboundProvider(
      providerRecord.provider_key,
    );
    const isOutboundWebhook =
      providerRecord.provider_key === OUTBOUND_WEBHOOK_PROVIDER_KEY;

    if (isOutboundWebhook) {
      if (!outboundUrl) {
        return {
          status: "error",
          message: "Fix the highlighted fields and try again.",
          fieldErrors: { outbound_url: "A destination URL is required." },
        };
      }

      let parsed: URL;

      try {
        parsed = new URL(outboundUrl);
      } catch {
        return {
          status: "error",
          message: "Fix the highlighted fields and try again.",
          fieldErrors: { outbound_url: "Enter a valid URL." },
        };
      }

      if (parsed.protocol !== "https:") {
        return {
          status: "error",
          message: "Fix the highlighted fields and try again.",
          fieldErrors: { outbound_url: "Outbound webhooks require HTTPS." },
        };
      }
    }

    const needsGeneratedSecret = isInboundWebhook || isOutboundWebhook;

    if (needsGeneratedSecret && !isSecretsEncryptionConfigured()) {
      return {
        status: "error",
        message:
          "Secret storage is not configured for this environment. Set SECRETS_ENCRYPTION_KEY before creating webhook connections.",
      };
    }

    const config: Record<string, unknown> = {};
    let status = "not_connected";
    let credentialStatus = "missing";
    let healthSummary: string | null = null;

    if (isInboundWebhook) {
      status = "connected";
      credentialStatus = "configured";
      healthSummary = "Waiting for the first inbound event.";
    } else if (isOutboundWebhook) {
      config.destination_url = outboundUrl;
      status = "connected";
      credentialStatus = "configured";
      healthSummary =
        "Ready to deliver signed CRM contact syncs when this connection is live.";
    }

    const { data: created, error: insertError } = await supabase
      .from("integration_connections")
      .insert({
        partner_id: access.partnerId,
        client_id: clientId,
        provider_id: providerRecord.id,
        display_name: displayName,
        status,
        runtime_mode: runtimeMode,
        credential_status: credentialStatus,
        config,
        health_summary: healthSummary,
        created_by: access.userId,
      })
      .select("id")
      .single();

    if (insertError || !created) {
      return {
        status: "error",
        message: "The connection could not be created. Try again.",
      };
    }

    let oneTimeToken: string | undefined;

    if (needsGeneratedSecret) {
      const token = generateWebhookToken();
      const { error: secretError } = await supabase
        .from("integration_secrets")
        .insert({
          partner_id: access.partnerId,
          client_id: clientId,
          connection_id: created.id,
          secret_kind: isInboundWebhook ? "webhook_token" : "signing_secret",
          encrypted_value: encryptSecret(token),
          last_four: secretLastFour(token),
        });

      if (secretError) {
        // Do not leave a half-configured webhook connection behind.
        await supabase
          .from("integration_connections")
          .delete()
          .eq("id", created.id);

        return {
          status: "error",
          message: "The connection credential could not be stored. Try again.",
        };
      }

      oneTimeToken = token;
    }

    await recordAuditEvent({
      actor: access,
      action: "integration.connection_created",
      targetType: "integration_connection",
      targetId: created.id,
      summary: `Created ${providerRecord.display_name} connection "${displayName}".`,
      afterSnapshot: {
        provider_key: providerRecord.provider_key,
        display_name: displayName,
        status,
        runtime_mode: runtimeMode,
        credential_status: credentialStatus,
      },
    });

    revalidatePath(`/partner/clients/${clientId}/integrations`);

    return {
      status: "success",
      message: `Connection "${displayName}" created.`,
      connectionId: created.id,
      oneTimeToken,
      endpointPath: isInboundWebhook
        ? inboundWebhookPath(created.id)
        : undefined,
    };
  } catch (error) {
    return deniedState(error);
  }
}

async function loadConnectionForUpdate(
  userId: string,
  clientId: string,
  connectionId: string,
) {
  const access = await requireClientWorkspaceAccess(
    userId,
    clientId,
    PARTNER_OPERATOR_ROLES,
  );

  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.partnerId) {
    return null;
  }

  const { data: connection, error } = await supabase
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, display_name, status, runtime_mode, provider:integration_providers(provider_key, display_name)",
    )
    .eq("id", connectionId)
    .eq("client_id", clientId)
    .eq("partner_id", access.partnerId)
    .maybeSingle();

  if (error || !connection) {
    return null;
  }

  return { access, supabase, connection };
}

export async function setConnectionPaused(
  clientId: string,
  connectionId: string,
  paused: boolean,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  try {
    const loaded = await loadConnectionForUpdate(
      authState.user.id,
      clientId,
      connectionId,
    );

    if (!loaded) {
      return { status: "error", message: "Connection not found." };
    }

    const { access, supabase, connection } = loaded;
    const nextStatus = paused ? "paused" : "connected";

    const { error } = await supabase
      .from("integration_connections")
      .update({ status: nextStatus })
      .eq("id", connectionId);

    if (error) {
      return { status: "error", message: "The connection could not be updated." };
    }

    await recordAuditEvent({
      actor: access,
      action: paused
        ? "integration.connection_paused"
        : "integration.connection_resumed",
      targetType: "integration_connection",
      targetId: connectionId,
      summary: `${paused ? "Paused" : "Resumed"} connection "${connection.display_name}".`,
      beforeSnapshot: { status: connection.status },
      afterSnapshot: { status: nextStatus },
    });

    revalidatePath(`/partner/clients/${clientId}/integrations`);
    revalidatePath(
      `/partner/clients/${clientId}/integrations/${connectionId}`,
    );

    return {
      status: "success",
      message: paused ? "Connection paused." : "Connection resumed.",
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function updateConnectionRuntimeMode(
  clientId: string,
  connectionId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  const runtimeMode = String(formData.get("runtime_mode") ?? "");

  if (!RUNTIME_MODES.includes(runtimeMode as never)) {
    return { status: "error", message: "Choose a valid runtime mode." };
  }

  try {
    const loaded = await loadConnectionForUpdate(
      authState.user.id,
      clientId,
      connectionId,
    );

    if (!loaded) {
      return { status: "error", message: "Connection not found." };
    }

    const { access, supabase, connection } = loaded;

    const { error } = await supabase
      .from("integration_connections")
      .update({ runtime_mode: runtimeMode })
      .eq("id", connectionId);

    if (error) {
      return { status: "error", message: "The runtime mode could not be changed." };
    }

    await recordAuditEvent({
      actor: access,
      action: "integration.runtime_mode_changed",
      targetType: "integration_connection",
      targetId: connectionId,
      summary: `Changed runtime mode for "${connection.display_name}" to ${runtimeMode}.`,
      beforeSnapshot: { runtime_mode: connection.runtime_mode },
      afterSnapshot: { runtime_mode: runtimeMode },
    });

    revalidatePath(`/partner/clients/${clientId}/integrations`);
    revalidatePath(
      `/partner/clients/${clientId}/integrations/${connectionId}`,
    );

    return { status: "success", message: "Runtime mode updated." };
  } catch (error) {
    return deniedState(error);
  }
}

// Enables (or rotates) the public website-chat widget key. The key is
// public by design — it ships in website markup — and only lets visitors
// start a chat with this client's assistant.
export async function enableChatWidget(
  clientId: string,
  connectionId: string,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  try {
    const loaded = await loadConnectionForUpdate(
      authState.user.id,
      clientId,
      connectionId,
    );

    if (!loaded) {
      return { status: "error", message: "Connection not found." };
    }

    const { access, supabase, connection } = loaded;
    const providerKey = (
      connection as unknown as { provider: { provider_key: string } | null }
    ).provider?.provider_key;

    if (providerKey !== "northstar_web_chat") {
      return {
        status: "error",
        message: "The widget key belongs on a Northstar web chat connection.",
      };
    }

    const { data: current } = await supabase
      .from("integration_connections")
      .select("config")
      .eq("id", connectionId)
      .maybeSingle();

    const { generateWidgetKey } = await import("@/lib/chat/widget");
    const widgetKey = generateWidgetKey();

    const { error } = await supabase
      .from("integration_connections")
      .update({
        config: {
          ...((current?.config as Record<string, unknown>) ?? {}),
          widget_public_key: widgetKey,
        },
      })
      .eq("id", connectionId);

    if (error) {
      return { status: "error", message: "The widget key could not be saved." };
    }

    await recordAuditEvent({
      actor: access,
      action: "integration.widget_key_rotated",
      targetType: "integration_connection",
      targetId: connectionId,
      summary: `Generated a website chat widget key for "${connection.display_name}". Any previously embedded widget stops working.`,
    });

    revalidatePath(
      `/partner/clients/${clientId}/integrations/${connectionId}`,
    );

    return {
      status: "success",
      message: "Widget enabled. Embed the snippet shown on this page.",
    };
  } catch (error) {
    return deniedState(error);
  }
}

export async function rotateConnectionSecret(
  clientId: string,
  connectionId: string,
): Promise<ConnectionFormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage integrations." };
  }

  if (!isSecretsEncryptionConfigured()) {
    return {
      status: "error",
      message: "Secret storage is not configured for this environment.",
    };
  }

  try {
    const loaded = await loadConnectionForUpdate(
      authState.user.id,
      clientId,
      connectionId,
    );

    if (!loaded) {
      return { status: "error", message: "Connection not found." };
    }

    const { access, supabase, connection } = loaded;
    const token = generateWebhookToken();

    const { data: updatedRows, error } = await supabase
      .from("integration_secrets")
      .update({
        encrypted_value: encryptSecret(token),
        last_four: secretLastFour(token),
      })
      .eq("connection_id", connectionId)
      .select("id");

    if (error || !updatedRows || updatedRows.length === 0) {
      return {
        status: "error",
        message: "This connection has no rotatable credential.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "integration.secret_rotated",
      targetType: "integration_connection",
      targetId: connectionId,
      summary: `Rotated credential for connection "${connection.display_name}". Previous credential is no longer accepted.`,
    });

    revalidatePath(
      `/partner/clients/${clientId}/integrations/${connectionId}`,
    );

    return {
      status: "success",
      message:
        "Credential rotated. Update the external system with the new value below — it is shown only once.",
      oneTimeToken: token,
    };
  } catch (error) {
    return deniedState(error);
  }
}
