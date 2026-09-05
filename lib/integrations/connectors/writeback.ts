import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "../../audit/redact.ts";
import { extractContactFields } from "../../crm/contact-fields.ts";
import type { RunStep } from "../../workflows/handlers.ts";

import { getConnectorAdapter } from "./adapters.ts";
import type { CanonicalObjectType, ConnectorCapability } from "./types.ts";

type WritebackConnection = {
  id: string;
  runtime_mode: string;
  config: Record<string, unknown> | null;
  provider: {
    provider_key: string;
    display_name: string;
    category: string;
  } | null;
};

export type LeadWritebackPlan = {
  objectType: "customer" | "lead";
  operation: "create" | "update";
  nativeObjectId: string;
  externalObjectId?: string | null;
  idempotencyKey: string;
  data: Record<string, unknown>;
};

export function planLeadConnectorWriteback(input: {
  providerKey: string;
  capabilities: readonly ConnectorCapability[];
  workflowRunId: string;
  contactId?: string | null;
  leadId?: string | null;
  eventType: string;
  eventData: Record<string, unknown>;
  runSummary: string;
  connectionConfig?: Record<string, unknown> | null;
  externalObjectId?: string | null;
}): LeadWritebackPlan | null {
  const fields = extractContactFields(input.eventData);
  if (!fields.email && !fields.phone) return null;

  const sharedData = {
    first_name: fields.firstname,
    last_name: fields.lastname,
    name: [fields.firstname, fields.lastname].filter(Boolean).join(" ") || null,
    email: fields.email,
    phone: fields.phone,
    address: fields.address,
    description: input.runSummary,
    summary: input.runSummary,
    source_event_type: input.eventType,
    customer_id: input.externalObjectId ?? null,
  };

  if (input.capabilities.includes("lead.create")) {
    return {
      objectType: "lead",
      operation: "create",
      nativeObjectId: input.leadId ?? input.workflowRunId,
      idempotencyKey: `workflow-${input.workflowRunId}-lead-create`,
      data: sharedData,
    };
  }

  if (input.capabilities.includes("customer.create")) {
    const operation =
      input.externalObjectId && input.capabilities.includes("customer.update")
        ? "update"
        : "create";
    return {
      objectType: "customer",
      operation,
      nativeObjectId: input.contactId ?? input.workflowRunId,
      externalObjectId: input.externalObjectId,
      idempotencyKey: `workflow-${input.workflowRunId}-customer-${operation}`,
      data: sharedData,
    };
  }

  return null;
}

export type LeadConnectorWritebackResult = {
  step: RunStep;
  writeback: Record<string, unknown>;
};

// Queues the lead for the client's field-service system. The queue is the
// durable boundary: provider calls happen in the connector worker with retry,
// idempotency, and a second live-mode check immediately before delivery.
export async function enqueueLeadConnectorWriteback(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    workflowRunId: string;
    templateKey: string;
    eventType: string;
    eventData: Record<string, unknown>;
    runSummary: string;
    contactId?: string | null;
    leadId?: string | null;
  },
): Promise<LeadConnectorWritebackResult | null> {
  if (input.templateKey !== "new_lead_intake") return null;

  try {
    const { data } = await admin
      .from("integration_connections")
      .select(
        "id, runtime_mode, config, provider:integration_providers!inner(provider_key, display_name, category)",
      )
      .eq("partner_id", input.partnerId)
      .eq("client_id", input.clientId)
      .eq("status", "connected")
      .eq("provider.category", "field_service")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const connection = data as unknown as WritebackConnection | null;
    if (!connection?.provider) return null;

    const adapter = getConnectorAdapter(connection.provider.provider_key);
    if (!adapter) return null;

    let externalIdentity: {
      objectType: "customer" | "lead";
      externalObjectId: string;
    } | null = null;
    if (input.contactId) {
      const { data: link } = await admin
        .from("integration_object_links")
        .select("object_type, external_object_id")
        .eq("connection_id", connection.id)
        .in("object_type", ["customer", "lead"])
        .eq("native_object_id", input.contactId)
        .order("last_synced_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (
        link?.external_object_id &&
        (link.object_type === "customer" || link.object_type === "lead")
      ) {
        externalIdentity = {
          objectType: link.object_type,
          externalObjectId: link.external_object_id,
        };
      }
    }
    if (
      !externalIdentity &&
      input.eventData.external_provider_key === connection.provider.provider_key
    ) {
      if (typeof input.eventData.external_customer_id === "string") {
        externalIdentity = {
          objectType: "customer",
          externalObjectId: input.eventData.external_customer_id,
        };
      } else if (typeof input.eventData.external_lead_id === "string") {
        externalIdentity = {
          objectType: "lead",
          externalObjectId: input.eventData.external_lead_id,
        };
      }
    }

    const externalCustomerId =
      externalIdentity?.objectType === "customer"
        ? externalIdentity.externalObjectId
        : null;

    const plan = planLeadConnectorWriteback({
      providerKey: connection.provider.provider_key,
      capabilities: adapter.manifest.capabilities,
      workflowRunId: input.workflowRunId,
      contactId: input.contactId,
      leadId: input.leadId,
      eventType: input.eventType,
      eventData: input.eventData,
      runSummary: input.runSummary,
      connectionConfig: connection.config,
      externalObjectId: externalCustomerId,
    });

    if (!plan) {
      return {
        step: {
          name: `${connection.provider.display_name} write-back skipped`,
          detail:
            "The intake did not include an email address or phone number, so no external record was created.",
        },
        writeback: { status: "skipped", reason: "no_contact_identifier" },
      };
    }

    if (
      externalIdentity?.objectType === plan.objectType &&
      !adapter.manifest.capabilities.includes(`${plan.objectType}.update`)
    ) {
      const idempotencyKey = `workflow-${input.workflowRunId}-${plan.objectType}-already-linked`;
      const reason = `existing_external_${plan.objectType}`;
      const { error: eventError } = await admin
        .from("integration_events")
        .insert({
          partner_id: input.partnerId,
          client_id: input.clientId,
          connection_id: connection.id,
          workflow_run_id: input.workflowRunId,
          direction: "outbound",
          event_type: `connector.${plan.objectType}_writeback_skipped`,
          status: "skipped",
          idempotency_key: idempotencyKey,
          external_object_type: plan.objectType,
          external_object_id: externalIdentity.externalObjectId,
          request_payload: redactAuditValue({
            reason,
            provider: connection.provider.provider_key,
          }),
          redacted: true,
        });
      if (eventError && eventError.code !== "23505") throw eventError;

      return {
        step: {
          name: `${connection.provider.display_name} ${plan.objectType} matched`,
          detail: `The caller is already linked to this external ${plan.objectType}, so no duplicate record was created.`,
        },
        writeback: {
          status: "skipped",
          reason,
          provider: connection.provider.provider_key,
          object_type: plan.objectType,
          external_object_id: externalIdentity.externalObjectId,
        },
      };
    }

    if (connection.runtime_mode !== "live") {
      const { error: previewEventError } = await admin
        .from("integration_events")
        .insert({
          partner_id: input.partnerId,
          client_id: input.clientId,
          connection_id: connection.id,
          workflow_run_id: input.workflowRunId,
          direction: "outbound",
          event_type: `connector.${plan.objectType}_writeback_preview`,
          status: "dry_run",
          idempotency_key: plan.idempotencyKey,
          external_object_type: plan.objectType,
          request_payload: redactAuditValue(plan.data),
          redacted: true,
        });
      if (previewEventError && previewEventError.code !== "23505") {
        throw previewEventError;
      }

      return {
        step: {
          name: `${connection.provider.display_name} write-back (dry run)`,
          detail: `Built the ${plan.objectType} payload without sending it. Switch this connection to live to create records automatically.`,
        },
        writeback: {
          status: "dry_run",
          provider: connection.provider.provider_key,
          object_type: plan.objectType,
        },
      };
    }

    const { error } = await admin.from("integration_sync_jobs").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: connection.id,
      direction: "push",
      object_type: plan.objectType as CanonicalObjectType,
      operation: plan.operation,
      status: "queued",
      idempotency_key: plan.idempotencyKey,
      payload: {
        nativeObjectId: plan.nativeObjectId,
        externalObjectId: plan.externalObjectId ?? null,
        idempotencyKey: plan.idempotencyKey,
        data: plan.data,
      },
      scheduled_for: new Date().toISOString(),
    });

    if (error && error.code !== "23505") throw error;

    if (!error) {
      const { error: eventError } = await admin
        .from("integration_events")
        .insert({
          partner_id: input.partnerId,
          client_id: input.clientId,
          connection_id: connection.id,
          workflow_run_id: input.workflowRunId,
          direction: "outbound",
          event_type: `connector.${plan.objectType}_writeback_queued`,
          status: "processed",
          idempotency_key: plan.idempotencyKey,
          external_object_type: plan.objectType,
          request_payload: redactAuditValue(plan.data),
          redacted: true,
        });
      if (eventError) throw eventError;
    }

    return {
      step: {
        name: `${connection.provider.display_name} write-back queued`,
        detail: `Queued the new ${plan.objectType} for automatic delivery with retry protection.`,
      },
      writeback: {
        status: "queued",
        provider: connection.provider.provider_key,
        object_type: plan.objectType,
      },
    };
  } catch (error) {
    return {
      step: {
        name: "External system write-back failed",
        detail: `${error instanceof Error ? error.message : "The write-back could not be queued."} The intake run itself completed.`,
      },
      writeback: { status: "failed" },
    };
  }
}
