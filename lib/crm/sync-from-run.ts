import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  buildContactPayloadPreview,
  syncContactWithNote,
  type HubSpotContactFields,
  type HubSpotCredentials,
} from "@/lib/integrations/providers/hubspot";
import type { RunStep } from "@/lib/workflows/handlers";

// CRM sync step for the pilot loop: after a lead-bearing run, upsert the
// contact in the client's connected CRM and leave an "AI Assistant" note.
// Explicitly marked SAFE (docs/13): additive contact/note writes only — no
// stage changes, no deletions, nothing customer-facing. Everything else
// stays approval-gated. Never throws: CRM problems mark the connection, log
// an event, and surface as a step on the run.

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

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractContactFields(
  data: Record<string, unknown>,
): HubSpotContactFields {
  const fullName = asString(data.name) || asString(data.full_name);
  const [firstname, ...rest] = fullName.split(/\s+/).filter(Boolean);

  return {
    email: asString(data.email) || null,
    phone: asString(data.phone) || null,
    firstname: firstname || null,
    lastname: rest.length > 0 ? rest.join(" ") : null,
    address: asString(data.address) || null,
  };
}

export async function syncRunToCrm(
  admin: SupabaseClient,
  input: CrmSyncInput,
): Promise<CrmSyncStepResult | null> {
  if (!SYNCABLE_TEMPLATES.has(input.templateKey)) {
    return null;
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", input.clientId)
    .eq("partner_id", input.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.provider_key", "hubspot")
    .limit(1)
    .maybeSingle();

  if (!connection) {
    return null;
  }

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
    "AI Assistant — Northstar",
    "",
    input.runSummary,
    "",
    `Source: ${input.eventType}. Full run detail is available in Northstar.`,
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
    });
  };

  if (connection.runtime_mode !== "live") {
    await logEvent("dry_run", "crm.contact_sync_preview", {
      note: "Dry run — the exact payload above would be sent in live mode.",
    });

    return {
      step: {
        name: "CRM sync (dry run)",
        detail:
          "Built the exact HubSpot contact + AI Assistant note payload without sending. Switch the HubSpot connection to live mode to sync for real.",
      },
      crm: { status: "dry_run", provider: "hubspot", preview: payloadPreview },
    };
  }

  try {
    const credentials = await readProviderCredentials<HubSpotCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.privateAppToken) {
      throw new Error("HubSpot credentials are missing. Reconnect HubSpot.");
    }

    const outcome = await syncContactWithNote(credentials, fields, noteBody);

    await logEvent("sent", "crm.contact_synced", {
      contact_id: outcome.contactId,
      contact_action: outcome.contactAction,
      note_id: outcome.noteId,
    });

    await admin
      .from("integration_connections")
      .update({ last_success_at: new Date().toISOString(), status: "connected" })
      .eq("id", connection.id);

    return {
      step: {
        name: "CRM synced",
        detail: `HubSpot contact ${outcome.contactAction} (${outcome.contactId})${
          outcome.noteId
            ? " with an AI Assistant note"
            : "; the AI Assistant note could not be attached"
        }.`,
      },
      crm: {
        status: "synced",
        provider: "hubspot",
        contact_id: outcome.contactId,
        contact_action: outcome.contactAction,
        note_id: outcome.noteId,
      },
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "CRM sync failed.";

    await logEvent("failed", "crm.contact_sync_failed", {}, message);

    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
        health_summary: `Last CRM sync failed: ${message}`,
      })
      .eq("id", connection.id);

    return {
      step: {
        name: "CRM sync failed",
        detail: `${message} The run itself completed; fix the HubSpot connection and future leads will sync.`,
      },
      crm: { status: "failed", provider: "hubspot", error: message },
    };
  }
}
