import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import {
  extractContactFields,
  type ContactFields,
} from "@/lib/crm/contact-fields";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  syncGoHighLevelContactWithNote,
  type GoHighLevelCredentials,
} from "@/lib/integrations/providers/gohighlevel";
import {
  buildContactPayloadPreview,
  syncContactWithNote,
  type HubSpotCredentials,
} from "@/lib/integrations/providers/hubspot";
import { deliverOutboundWebhook } from "@/lib/integrations/providers/outbound-webhook";
import { decryptSecret } from "@/lib/integrations/secrets";
import { OUTBOUND_WEBHOOK_PROVIDER_KEY } from "@/lib/integrations/types";
import type { RunStep } from "@/lib/workflows/handlers";

// CRM sync step for the run engine: after a lead-bearing run, upsert the
// contact in the client's connected CRM and leave an "AI Assistant" note.
// Adapters: HubSpot, GoHighLevel, and — when no native CRM is connected —
// a signed generic outbound webhook so any system can receive the same
// payload. Explicitly marked SAFE (docs/13): additive contact/note writes
// only — no stage changes, no deletions, nothing customer-facing. Never
// throws: CRM problems mark the connection, log an event, and surface as a
// step on the run.

const SYNCABLE_TEMPLATES = new Set(["new_lead_intake", "ai_intake_router"]);

type CrmSyncInput = {
  partnerId: string;
  clientId: string;
  runId: string;
  templateKey: string;
  clientName: string;
  eventType: string;
  eventData: Record<string, unknown>;
  runSummary: string;
};

export type CrmSyncStepResult = {
  step: RunStep;
  crm: Record<string, unknown>;
};

type CrmConnectionRow = {
  id: string;
  runtime_mode: string;
  status: string;
  error_count: number | null;
  config: Record<string, unknown> | null;
  provider: { provider_key: string; category: string } | null;
};

async function findCrmConnection(
  admin: SupabaseClient,
  input: CrmSyncInput,
): Promise<CrmConnectionRow | null> {
  // Native CRM first (HubSpot, GoHighLevel — anything in category "crm").
  const { data: native } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, config, provider:integration_providers!inner(provider_key, category)",
    )
    .eq("client_id", input.clientId)
    .eq("partner_id", input.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.category", "crm")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (native) {
    return native as unknown as CrmConnectionRow;
  }

  // Fallback: generic signed outbound webhook (client middleware, a
  // Zapier/Make bridge, or a homegrown system).
  const { data: webhook } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, config, provider:integration_providers!inner(provider_key, category)",
    )
    .eq("client_id", input.clientId)
    .eq("partner_id", input.partnerId)
    .in("status", ["connected", "needs_attention", "not_connected"])
    .eq("provider.provider_key", OUTBOUND_WEBHOOK_PROVIDER_KEY)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (webhook as unknown as CrmConnectionRow) ?? null;
}

async function readSigningSecret(
  admin: SupabaseClient,
  connectionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("integration_secrets")
    .select("encrypted_value")
    .eq("connection_id", connectionId)
    .eq("secret_kind", "signing_secret")
    .maybeSingle();

  if (!data?.encrypted_value) {
    return null;
  }

  try {
    return decryptSecret(data.encrypted_value);
  } catch {
    return null;
  }
}

type LiveSyncResult = {
  detail: string;
  crm: Record<string, unknown>;
};

async function runLiveSync(
  admin: SupabaseClient,
  connection: CrmConnectionRow,
  fields: ContactFields,
  noteBody: string,
  input: CrmSyncInput,
): Promise<LiveSyncResult> {
  const providerKey = connection.provider?.provider_key ?? "";

  if (providerKey === "hubspot") {
    const credentials = await readProviderCredentials<HubSpotCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.privateAppToken) {
      throw new Error("HubSpot credentials are missing. Reconnect HubSpot.");
    }

    const outcome = await syncContactWithNote(credentials, fields, noteBody);

    return {
      detail: `HubSpot contact ${outcome.contactAction} (${outcome.contactId})${
        outcome.noteId
          ? " with an AI Assistant note"
          : "; the AI Assistant note could not be attached"
      }.`,
      crm: {
        status: "synced",
        provider: "hubspot",
        contact_id: outcome.contactId,
        contact_action: outcome.contactAction,
        note_id: outcome.noteId,
      },
    };
  }

  if (providerKey === "gohighlevel") {
    const credentials = await readProviderCredentials<GoHighLevelCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.privateToken || !credentials.locationId) {
      throw new Error(
        "GoHighLevel credentials are missing. Reconnect GoHighLevel.",
      );
    }

    const outcome = await syncGoHighLevelContactWithNote(
      credentials,
      fields,
      noteBody,
    );

    return {
      detail: `GoHighLevel contact ${outcome.contactAction} (${outcome.contactId})${
        outcome.noteId
          ? " with an AI Assistant note"
          : "; the AI Assistant note could not be attached"
      }.`,
      crm: {
        status: "synced",
        provider: "gohighlevel",
        contact_id: outcome.contactId,
        contact_action: outcome.contactAction,
        note_id: outcome.noteId,
      },
    };
  }

  if (providerKey === OUTBOUND_WEBHOOK_PROVIDER_KEY) {
    const destinationUrl =
      typeof connection.config?.destination_url === "string"
        ? connection.config.destination_url
        : "";
    const signingSecret = await readSigningSecret(admin, connection.id);

    if (!destinationUrl || !signingSecret) {
      throw new Error(
        "The outbound webhook is missing its destination URL or signing secret.",
      );
    }

    const result = await deliverOutboundWebhook({
      destinationUrl,
      signingSecret,
      eventType: "crm.contact_sync",
      data: {
        contact: {
          email: fields.email,
          phone: fields.phone,
          first_name: fields.firstname,
          last_name: fields.lastname,
          address: fields.address,
        },
        note: noteBody,
        source_event_type: input.eventType,
        client_name: input.clientName,
      },
    });

    return {
      detail: `Contact payload delivered to the outbound webhook (HTTP ${result.status}), signed with the connection's secret.`,
      crm: {
        status: "synced",
        provider: "outbound_webhook",
        http_status: result.status,
      },
    };
  }

  throw new Error(`No CRM adapter is available for "${providerKey}".`);
}

export async function syncRunToCrm(
  admin: SupabaseClient,
  input: CrmSyncInput,
): Promise<CrmSyncStepResult | null> {
  if (!SYNCABLE_TEMPLATES.has(input.templateKey)) {
    return null;
  }

  const connection = await findCrmConnection(admin, input);

  if (!connection) {
    return null;
  }

  const providerKey = connection.provider?.provider_key ?? "crm";
  const providerLabel =
    providerKey === "hubspot"
      ? "HubSpot"
      : providerKey === "gohighlevel"
        ? "GoHighLevel"
        : "the outbound webhook";

  const fields = extractContactFields(input.eventData);

  if (!fields.email && !fields.phone) {
    return {
      step: {
        name: "CRM sync skipped",
        detail:
          "No email or phone was present in the event, so there is nothing to upsert in the CRM.",
      },
      crm: { status: "skipped", reason: "no_contact_identifier" },
    };
  }

  const noteBody = [
    "AI Assistant",
    "",
    input.runSummary,
    "",
    `Source: ${input.eventType}.`,
  ].join("\n");

  const payloadPreview = buildContactPayloadPreview(fields, noteBody);

  const logEvent = async (
    status: "sent" | "dry_run" | "failed",
    eventType: string,
    response: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    await admin.from("integration_events").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: connection.id,
      workflow_run_id: input.runId,
      direction: "outbound",
      event_type: eventType,
      status,
      request_payload: redactAuditValue(payloadPreview),
      response_payload: redactAuditValue(response),
      error_message: errorMessage ?? null,
      redacted: true,
    }).throwOnError();
  };

  if (connection.runtime_mode !== "live") {
    await logEvent("dry_run", "crm.contact_sync_preview", {
      note: "Dry run — the exact payload above would be sent in live mode.",
      provider: providerKey,
    });

    return {
      step: {
        name: "CRM sync (dry run)",
        detail: `Built the exact contact + AI Assistant note payload for ${providerLabel} without sending. Switch the connection to live mode to sync for real.`,
      },
      crm: {
        status: "dry_run",
        provider: providerKey,
        preview: payloadPreview,
      },
    };
  }

  try {
    const outcome = await runLiveSync(
      admin,
      connection,
      fields,
      noteBody,
      input,
    );

    await logEvent("sent", "crm.contact_synced", outcome.crm);

    await admin
      .from("integration_connections")
      .update({
        last_success_at: new Date().toISOString(),
        status: "connected",
      })
      .eq("id", connection.id).throwOnError();

    return {
      step: { name: "CRM synced", detail: outcome.detail },
      crm: outcome.crm,
    };
  } catch {
    // HubSpot/GHL may have committed a contact or note before a timeout or a
    // persistence failure. No live failure from this multi-step path is safe
    // for automatic replay, including a failure while recording success.
    const message = "CRM write outcome is uncertain. Check the provider contact and notes before creating another sync; automatic replay is disabled.";

    await logEvent("failed", "crm.contact_sync_uncertain", {}, message);

    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
        health_summary: `Last CRM sync failed: ${message}`,
      })
      .eq("id", connection.id).throwOnError();

    return {
      step: {
        name: "CRM sync needs reconciliation",
        detail: message,
      },
      crm: { status: "uncertain", provider: providerKey, error: message },
    };
  }
}
