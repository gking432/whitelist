import { createHash } from "node:crypto";
import { supportsImportedLeadAutomation } from "./catalog";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  encryptProviderCredentials,
  PROVIDER_CREDENTIALS_KIND,
  readProviderCredentials,
} from "@/lib/integrations/credentials";
import {
  refreshJobberCredentials,
  type JobberCredentials,
} from "@/lib/integrations/providers/jobber-oauth";
import {
  refreshQuickBooksCredentials,
  refreshSquareCredentials,
  type QuickBooksCredentials,
  type SquareCredentials,
} from "@/lib/integrations/providers/commerce-oauth";
import { refreshTelephonyCredentials } from "@/lib/integrations/providers/telephony-oauth";
import type { RingCentralCredentials } from "@/lib/integrations/providers/ringcentral";
import type { DialpadCredentials } from "@/lib/integrations/providers/dialpad";
import {
  refreshGoogleMarketingCredentials,
  refreshPodiumCredentials,
  type GoogleAdsCredentials,
  type GoogleBusinessProfileCredentials,
  type PodiumCredentials,
} from "@/lib/integrations/providers/marketing-oauth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { getConnectorAdapter } from "./adapters";
import { connectorFailurePolicy, ConnectorExecutionCancelledError } from "./errors";
import { enqueueInboundEvent } from "@/lib/integrations/inbound/queue";
import {
  connectorLeaseCutoff,
  shouldProjectConnectorRecord,
  staleConnectorJobDisposition,
} from "./runtime-policy";
import {
  connectorRetryDelayMinutes,
  executeConnectorSyncJob,
  type ConnectorSyncJob,
} from "./sync-executor";
import type { CanonicalRecord, ConnectorContext } from "./types";
import type { ConnectorFieldMapping } from "./types";

type JobRow = ConnectorSyncJob & {
  partner_id: string;
  client_id: string;
  connection_id: string;
  provider: { provider_key: string } | null;
  connection_config: Record<string, unknown>;
  connection_status: string;
  connection_runtime_mode: string;
};

function value(data: Record<string, unknown>, key: string): string | null {
  return typeof data[key] === "string" && data[key] ? String(data[key]) : null;
}

async function projectCanonicalRecord(
  admin: SupabaseClient,
  job: JobRow,
  record: CanonicalRecord,
) {
  const { data: client } = await admin
    .from("client_businesses")
    .select("crm_operating_mode")
    .eq("id", job.client_id)
    .maybeSingle().throwOnError();
  if (!client || !shouldProjectConnectorRecord(client.crm_operating_mode)) {
    return null;
  }

  const { data: existingLink } = await admin
    .from("integration_object_links")
    .select("native_object_id")
    .eq("connection_id", job.connection_id)
    .eq("object_type", record.objectType)
    .eq("external_object_id", record.externalId)
    .maybeSingle().throwOnError();

  if (record.deleted) {
    if (record.objectType === "appointment" && existingLink?.native_object_id) {
      await admin
        .from("crm_appointments")
        .update({ status: "cancelled" })
        .eq("id", existingLink.native_object_id)
        .eq("client_id", job.client_id).throwOnError();
    }
    return existingLink?.native_object_id ?? null;
  }

  if (record.objectType === "customer") {
    const contactValues = {
      partner_id: job.partner_id,
      client_id: job.client_id,
      first_name: value(record.data, "first_name"),
      last_name: value(record.data, "last_name"),
      email: value(record.data, "email"),
      phone: value(record.data, "phone"),
      source: job.provider?.provider_key ?? "external_sync",
    };
    let contactId = existingLink?.native_object_id ?? null;
    if (!contactId && contactValues.email) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("email", contactValues.email)
        .limit(1)
        .maybeSingle().throwOnError();
      contactId = data?.id ?? null;
    }
    if (!contactId && contactValues.phone) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("phone", contactValues.phone)
        .limit(1)
        .maybeSingle().throwOnError();
      contactId = data?.id ?? null;
    }
    if (contactId) {
      await admin
        .from("crm_contacts")
        .update(contactValues)
        .eq("id", contactId)
        .eq("client_id", job.client_id).throwOnError();
    } else {
      const { data } = await admin
        .from("crm_contacts")
        .insert(contactValues)
        .select("id")
        .single().throwOnError();
      contactId = data?.id ?? null;
    }
    return contactId;
  }

  if (record.objectType === "lead") {
    const email = value(record.data, "email");
    const phone = value(record.data, "phone");
    let contactId: string | null = null;
    if (email) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("email", email)
        .limit(1)
        .maybeSingle().throwOnError();
      contactId = data?.id ?? null;
    }
    if (!contactId && phone) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle().throwOnError();
      contactId = data?.id ?? null;
    }
    if (!contactId) {
      const fullName = value(record.data, "name") ?? "External lead";
      const parts = fullName.split(/\s+/);
      const { data } = await admin
        .from("crm_contacts")
        .insert({
          partner_id: job.partner_id,
          client_id: job.client_id,
          first_name: value(record.data, "first_name") ?? parts[0],
          last_name:
            value(record.data, "last_name") ??
            (parts.slice(1).join(" ") || null),
          email,
          phone,
          source: job.provider?.provider_key ?? "external_sync",
        })
        .select("id")
        .single().throwOnError();
      contactId = data?.id ?? null;
    }
    if (!contactId) return null;
    let leadId = existingLink?.native_object_id ?? null;
    const status = value(record.data, "status")?.toLowerCase();
    const nativeStatus = [
      "new",
      "contacted",
      "quoted",
      "scheduled",
      "won",
      "lost",
    ].includes(status ?? "")
      ? status
      : "new";
    const leadValues = {
      partner_id: job.partner_id,
      client_id: job.client_id,
      contact_id: contactId,
      title:
        value(record.data, "title") ??
        value(record.data, "name") ??
        "External lead",
      description: value(record.data, "description"),
      status: nativeStatus,
      source_event_type: `${job.provider?.provider_key ?? "external"}.lead_sync`,
    };
    if (leadId) {
      await admin
        .from("crm_leads")
        .update(leadValues)
        .eq("id", leadId)
        .eq("client_id", job.client_id).throwOnError();
    } else {
      const { data } = await admin
        .from("crm_leads")
        .insert(leadValues)
        .select("id")
        .single().throwOnError();
      leadId = data?.id ?? null;
    }
    return leadId;
  }

  if (record.objectType === "appointment" || record.objectType === "job") {
    const startAt = value(record.data, "start_at");
    const endAt = value(record.data, "end_at");
    if (!startAt || !endAt) return null;
    const statusValue = value(record.data, "status");
    const appointmentValues = {
      partner_id: job.partner_id,
      client_id: job.client_id,
      title: value(record.data, "title") ?? "Calendar appointment",
      start_at: startAt,
      end_at: endAt,
      status: statusValue?.toLowerCase().includes("cancel")
        ? "cancelled"
        : "booked",
      external_ref: record.externalId,
      source: job.provider?.provider_key ?? "external_sync",
      notes: value(record.data, "description"),
    };
    let appointmentId = existingLink?.native_object_id ?? null;
    if (!appointmentId) {
      const { data } = await admin
        .from("crm_appointments")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("external_ref", record.externalId)
        .limit(1)
        .maybeSingle().throwOnError();
      appointmentId = data?.id ?? null;
    }
    if (appointmentId) {
      await admin
        .from("crm_appointments")
        .update(appointmentValues)
        .eq("id", appointmentId)
        .eq("client_id", job.client_id).throwOnError();
    } else {
      const { data } = await admin
        .from("crm_appointments")
        .insert(appointmentValues)
        .select("id")
        .single().throwOnError();
      appointmentId = data?.id ?? null;
    }
    return appointmentId;
  }

  if (record.objectType === "review") {
    const rawRating = record.data.rating;
    const ratingNames: Record<string, number> = {
      ONE: 1,
      TWO: 2,
      THREE: 3,
      FOUR: 4,
      FIVE: 5,
    };
    const rating =
      typeof rawRating === "number"
        ? Math.max(1, Math.min(5, Math.round(rawRating)))
        : (ratingNames[String(rawRating ?? "").toUpperCase()] ?? null);
    const feedbackText =
      value(record.data, "comment") ??
      "Rating received without a written comment.";
    const sentiment =
      rating === null
        ? "mixed"
        : rating >= 4
          ? "positive"
          : rating <= 2
            ? "negative"
            : "mixed";
    const riskLevel =
      rating !== null && rating <= 1
        ? "high"
        : rating !== null && rating <= 2
          ? "medium"
          : "low";
    const feedbackValues = {
      partner_id: job.partner_id,
      client_id: job.client_id,
      source:
        value(record.data, "source") ??
        job.provider?.provider_key ??
        "external_review",
      rating,
      feedback_text: feedbackText,
      sentiment: sentiment,
      risk_level: riskLevel,
      summary: feedbackText.slice(0, 500),
      suggested_internal_action:
        rating !== null && rating <= 2
          ? "Review the customer experience and assign a follow-up."
          : null,
      suggested_customer_response: value(record.data, "reply"),
      tags: [job.provider?.provider_key ?? "external_review"],
      ai_status: "fallback",
      raw_output: record.source,
    };
    let feedbackId = existingLink?.native_object_id ?? null;
    if (feedbackId)
      await admin
        .from("crm_feedback")
        .update(feedbackValues)
        .eq("id", feedbackId)
        .eq("client_id", job.client_id).throwOnError();
    else {
      const { data } = await admin
        .from("crm_feedback")
        .insert(feedbackValues)
        .select("id")
        .single().throwOnError();
      feedbackId = data?.id ?? null;
    }
    return feedbackId;
  }

  if (record.objectType === "campaign") {
    const number = (key: string) => {
      const raw = record.data[key];
      const parsed = Number(raw ?? 0);
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const { data } = await admin
      .from("marketing_campaign_snapshots")
      .upsert(
        {
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          external_campaign_id: record.externalId,
          source:
            value(record.data, "source") ??
            job.provider?.provider_key ??
            "external_campaign",
          name: value(record.data, "name") ?? "Campaign",
          status: value(record.data, "status"),
          impressions: number("impressions"),
          clicks: number("clicks"),
          spend: number("spend"),
          conversions: number("conversions"),
          conversion_value: number("conversion_value"),
          raw_metrics: record.source,
          synced_at: new Date().toISOString(),
        },
        { onConflict: "connection_id,external_campaign_id" },
      )
      .select("id")
      .single().throwOnError();
    return data?.id ?? null;
  }
  return null;
}

function repositoryFor(admin: SupabaseClient, job: JobRow) {
  return {
    async assertCanExecute(context: ConnectorContext) {
      const { data: current } = await admin.from("integration_connections")
        .select("config,status,runtime_mode,credential_status,provider:integration_providers(provider_key)")
        .eq("id", job.connection_id).eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle().throwOnError();
      const provider = current?.provider as unknown as { provider_key?: string } | null;
      if (!current || current.status !== "connected" || current.runtime_mode === "paused" || current.credential_status === "invalid" ||
          provider?.provider_key !== job.provider?.provider_key || (job.direction === "push" && current.runtime_mode !== "live")) {
        throw new ConnectorExecutionCancelledError();
      }
      job.connection_config = current.config ?? {};
      job.connection_runtime_mode = current.runtime_mode;
      context.config = job.connection_config;
    },
    async saveCanonicalRecord(record: CanonicalRecord) {
      const importEnabledAt = job.connection_config.lead_automation_enabled_at;
      const importKey = job.provider?.provider_key === "meta" ? record.externalId : `import-lead-${createHash("sha256").update(record.externalId).digest("hex")}`;
      let queuedLead = false;
      if (record.objectType === "lead") {
        const { data: imported } = await admin.from("integration_events").select("id")
          .eq("connection_id", job.connection_id).eq("direction", "inbound")
          .eq("idempotency_key", importKey).maybeSingle().throwOnError();
        queuedLead = Boolean(imported);
      }
      if (!queuedLead && supportsImportedLeadAutomation(job.provider?.provider_key ?? "") && record.objectType === "lead" && !record.deleted && record.data.status === "new" && job.connection_runtime_mode === "live" &&
          typeof importEnabledAt === "string" && record.updatedAt && Date.parse(record.updatedAt) >= Date.parse(importEnabledAt)) {
        const { data: prior } = await admin.from("integration_canonical_records").select("id")
          .eq("connection_id",job.connection_id).eq("object_type","lead").eq("external_object_id",record.externalId).maybeSingle().throwOnError();
        if (!prior) {
        await enqueueInboundEvent(admin, {
          partnerId: job.partner_id, clientId: job.client_id, connectionId: job.connection_id,
          eventType: "lead.created", idempotencyKey: importKey,
          data: { ...record.data, message: record.data.description, external_provider_key: job.provider?.provider_key,
            external_lead_id: record.externalId, external_customer_id: record.data.customer_id ?? null },
        });
        queuedLead = true;
        }
      }
      // The workflow performs contact/lead creation for newly imported leads;
      // projecting here as well would create a second native lead.
      const nativeObjectId = queuedLead ? null : await projectCanonicalRecord(admin, job, record);
      await admin.from("integration_canonical_records").upsert(
        {
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          object_type: record.objectType,
          external_object_id: record.externalId,
          external_parent_id: record.externalParentId ?? null,
          canonical_data: record.deleted
            ? { deleted: true }
            : record.data,
          source_payload: record.source,
          external_updated_at: record.updatedAt ?? null,
          native_object_id: nativeObjectId,
          projection_status: nativeObjectId ? "projected" : "skipped",
          projection_error: null,
          projected_at: nativeObjectId ? new Date().toISOString() : null,
        },
        { onConflict: "connection_id,object_type,external_object_id" },
      ).throwOnError();
      if (nativeObjectId) {
        await admin.from("integration_object_links").upsert(
          {
            partner_id: job.partner_id,
            client_id: job.client_id,
            connection_id: job.connection_id,
            object_type: record.objectType,
            native_object_id: nativeObjectId,
            external_object_id: record.externalId,
            external_parent_id: record.externalParentId ?? null,
            external_updated_at: record.updatedAt ?? null,
            last_synced_at: new Date().toISOString(),
          },
          { onConflict: "connection_id,object_type,native_object_id" },
        ).throwOnError();
      }
    },
    async saveCursor(cursor: Record<string, unknown> | null) {
      await admin.from("integration_sync_states").upsert(
        {
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          stream_key: job.objectType,
          cursor_value: cursor,
          status: "idle",
          last_completed_at: new Date().toISOString(),
          last_error: null,
        },
        { onConflict: "connection_id,stream_key" },
      ).throwOnError();
    },
    async saveObjectLink(input: {
      objectType: string;
      nativeObjectId: string;
      externalObjectId: string;
      externalParentId?: string | null;
      externalUpdatedAt?: string | null;
    }) {
      await admin.from("integration_object_links").upsert(
        {
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          object_type: input.objectType,
          native_object_id: input.nativeObjectId,
          external_object_id: input.externalObjectId,
          external_parent_id: input.externalParentId ?? null,
          external_updated_at: input.externalUpdatedAt ?? null,
          last_synced_at: new Date().toISOString(),
        },
        { onConflict: "connection_id,object_type,native_object_id" },
      ).throwOnError();
    },
  };
}

async function fieldMappingsFor(
  admin: SupabaseClient,
  job: JobRow,
): Promise<ConnectorFieldMapping[]> {
  const { data } = await admin
    .from("integration_field_mappings")
    .select(
      "id, object_type, direction, native_field, external_field, transform_key, default_value, is_required, is_active",
    )
    .eq("connection_id", job.connection_id)
    .eq("object_type", job.objectType)
    .eq("is_active", true)
    .order("created_at", { ascending: true }).throwOnError();
  return (data ?? []).map((mapping) => ({
    id: mapping.id,
    objectType: mapping.object_type,
    direction: mapping.direction,
    nativeField: mapping.native_field,
    externalField: mapping.external_field,
    transformKey: mapping.transform_key,
    defaultValue: mapping.default_value,
    isRequired: mapping.is_required,
    isActive: mapping.is_active,
  })) as ConnectorFieldMapping[];
}

export async function enqueueInitialConnectorSync(
  admin: SupabaseClient,
  scope: {
    partnerId: string;
    clientId: string;
    connectionId: string;
    providerKey: string;
  },
) {
  const adapter = getConnectorAdapter(scope.providerKey);
  if (!adapter) return;
  const objectTypes = Array.from(
    new Set(
      adapter.manifest.capabilities
        .filter((capability) => capability.endsWith(".read"))
        .map((capability) => capability.split(".")[0]),
    ),
  );
  for (const objectType of objectTypes) {
    const { data: existing } = await admin
      .from("integration_sync_jobs")
      .select("id")
      .eq("connection_id", scope.connectionId)
      .eq("object_type", objectType)
      .in("status", ["queued", "running", "failed"])
      .limit(1)
      .maybeSingle().throwOnError();
    if (existing) continue;
    const { data: syncState } = await admin
      .from("integration_sync_states")
      .select("cursor_value")
      .eq("connection_id", scope.connectionId)
      .eq("stream_key", objectType)
      .maybeSingle().throwOnError();
    const idempotencyKey = `resume-${objectType}-${crypto.randomUUID()}`;
    await admin.from("integration_sync_jobs").insert({
      partner_id: scope.partnerId,
      client_id: scope.clientId,
      connection_id: scope.connectionId,
      direction: "pull",
      object_type: objectType,
      operation: "sync",
      status: "queued",
      idempotency_key: idempotencyKey,
      payload: syncState?.cursor_value
        ? { cursor: syncState.cursor_value }
        : {},
      scheduled_for: new Date().toISOString(),
    }).throwOnError();
  }
}

export async function processConnectorSyncJobs(limit = 20) {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      recoveredPulls: 0,
      uncertainPushes: 0,
    };
  }
  const staleCutoff = connectorLeaseCutoff();

  // Pulls are safe to retry. A stale push may have reached the vendor before
  // the worker died, so replaying it could duplicate a customer or lead.
  const { data: stalePulls } = await admin
    .from("integration_sync_jobs")
    .select("id, attempts, max_attempts")
    .eq("status", "running")
    .eq("direction", "pull")
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`).throwOnError();

  let recoveredPulls = 0;
  for (const stale of stalePulls ?? []) {
    const attempts = stale.attempts + 1;
    const exhausted = attempts >= stale.max_attempts;
    const { data: recovered } = await admin
      .from("integration_sync_jobs")
      .update({
        status: exhausted
          ? "dead_letter"
          : staleConnectorJobDisposition("pull"),
        attempts,
        scheduled_for: new Date().toISOString(),
        completed_at: exhausted ? new Date().toISOString() : null,
        locked_at: null,
        locked_by: null,
        last_error: exhausted
          ? "Connector read exhausted its retry limit after the worker lease repeatedly expired."
          : "Recovered a stale connector read after its worker lease expired.",
      })
      .eq("id", stale.id)
      .eq("status", "running")
      .select("id")
      .maybeSingle().throwOnError();
    if (recovered) recoveredPulls += 1;
  }

  const { data: uncertainPushes } = await admin
    .from("integration_sync_jobs")
    .update({
      status: staleConnectorJobDisposition("push"),
      completed_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      last_error:
        "The connector worker stopped during an external write. Confirm the vendor record before retrying to prevent a duplicate.",
    })
    .eq("status", "running")
    .eq("direction", "push")
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`)
    .select("connection_id, object_type, payload").throwOnError();

  for (const stale of uncertainPushes ?? []) {
    await admin
      .from("integration_events")
      .update({
        event_type: `connector.${stale.object_type}_writeback_failed`,
        status: "failed",
        error_message:
          "Delivery outcome is unknown because the connector worker stopped mid-write. Reconcile the vendor record before retrying.",
      })
      .eq("connection_id", stale.connection_id)
      .eq("idempotency_key", String(stale.payload?.idempotencyKey ?? "")).throwOnError();
  }

  const { data } = await admin
    .from("integration_sync_jobs")
    .select(
      "*, connection:integration_connections!inner(config, status, runtime_mode, provider:integration_providers!inner(provider_key))",
    )
    .in("status", ["queued", "failed"])
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit).throwOnError();

  let succeeded = 0;
  let failed = 0;
  for (const raw of data ?? []) {
    // A batch may take minutes. Reload tenant-scoped connection state before
    // each claim, then assert it again immediately before the provider call.
    const { data: currentConnection } = await admin.from("integration_connections")
      .select("config,status,runtime_mode,provider:integration_providers(provider_key)")
      .eq("id", raw.connection_id).eq("partner_id", raw.partner_id).eq("client_id", raw.client_id).maybeSingle().throwOnError();
    const connection = (currentConnection ?? {}) as unknown as {
      config?: Record<string, unknown>;
      status?: string;
      runtime_mode?: string;
      provider?: { provider_key: string };
    };
    const job: JobRow = {
      id: raw.id,
      direction: raw.direction,
      objectType: raw.object_type,
      operation: raw.operation,
      attempts: raw.attempts,
      maxAttempts: raw.max_attempts,
      payload: raw.payload ?? {},
      partner_id: raw.partner_id,
      client_id: raw.client_id,
      connection_id: raw.connection_id,
      provider: connection.provider ?? null,
      connection_config: connection.config ?? {},
      connection_status: connection.status ?? "not_connected",
      connection_runtime_mode: connection.runtime_mode ?? "dry_run",
    } as JobRow;
    const adapter = job.provider
      ? getConnectorAdapter(job.provider.provider_key)
      : null;
    if (!adapter) {
      await admin
        .from("integration_sync_jobs")
        .update({
          status: "dead_letter",
          last_error: "Connector adapter is unavailable.",
        })
        .eq("id", job.id).in("status", ["queued", "failed"]).throwOnError();
      failed += 1;
      continue;
    }
    if (job.connection_status !== "connected" || job.connection_runtime_mode === "paused" ||
      (job.direction === "push" && job.connection_runtime_mode !== "live")) {
      await admin
        .from("integration_sync_jobs")
        .update({
          status: "cancelled",
          last_error:
            "Connector work cancelled because the connection is paused, disconnected, or not live for writes.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id).in("status", ["queued", "failed"]).throwOnError();
      await admin
        .from("integration_events")
        .update({
          event_type: `connector.${job.objectType}_writeback_skipped`,
          status: "skipped",
          error_message:
            "Write-back skipped because the connection is not connected and live.",
        })
        .eq("connection_id", job.connection_id)
        .eq("idempotency_key", String(job.payload.idempotencyKey ?? "")).throwOnError();
      failed += 1;
      continue;
    }
    const claimed = await admin
      .from("integration_sync_jobs")
      .update({
        status: "running",
        locked_at: new Date().toISOString(),
        locked_by: "cron",
      })
      .eq("id", job.id)
      .in("status", ["queued", "failed"])
      .select("id")
      .maybeSingle().throwOnError();
    if (!claimed.data) continue;
    let credentials = await readProviderCredentials<unknown>(
      admin,
      job.connection_id,
    );
    if (
      [
        "jobber",
        "quickbooks_online",
        "square",
        "ringcentral",
        "dialpad",
        "google_ads",
        "google_business_profile",
        "podium",
      ].includes(job.provider?.provider_key ?? "") &&
      credentials
    ) {
      try {
        const providerKey = job.provider?.provider_key;
        const refreshed =
          providerKey === "jobber"
            ? await refreshJobberCredentials(credentials as JobberCredentials)
            : providerKey === "quickbooks_online"
              ? await refreshQuickBooksCredentials(
                  credentials as QuickBooksCredentials,
                )
              : providerKey === "square"
                ? await refreshSquareCredentials(
                    credentials as SquareCredentials,
                  )
                : providerKey === "ringcentral" || providerKey === "dialpad"
                  ? await refreshTelephonyCredentials(
                      providerKey,
                      credentials as
                        RingCentralCredentials | DialpadCredentials,
                    )
                  : providerKey === "podium"
                    ? await refreshPodiumCredentials(
                        credentials as PodiumCredentials,
                      )
                    : await refreshGoogleMarketingCredentials(
                        credentials as
                          | GoogleAdsCredentials
                          | GoogleBusinessProfileCredentials,
                      );
        credentials = refreshed;
        const stored = encryptProviderCredentials(
          refreshed as unknown as Record<string, string>,
        );
        await admin
          .from("integration_secrets")
          .update({
            encrypted_value: stored.encrypted_value,
            last_four: stored.last_four,
            updated_at: new Date().toISOString(),
          })
          .eq("connection_id", job.connection_id)
          .eq("secret_kind", PROVIDER_CREDENTIALS_KIND).throwOnError();
      } catch (error) {
        const policy = connectorFailurePolicy(error, { direction: "pull", attempts: job.attempts, maxAttempts: job.maxAttempts });
        const detail = policy.reconnectRequired ? "Provider authorization rejected. Reconnect the account." : "Provider token refresh failed.";
        if (policy.reconnectRequired) {
          await admin.from("integration_connections").update({ status: "needs_attention", credential_status: "invalid", health_summary: detail, last_failure_at: new Date().toISOString() }).eq("id", job.connection_id).throwOnError();
          await admin.from("integration_sync_states").update({ status: "paused", last_error: detail }).eq("connection_id", job.connection_id).throwOnError();
          await admin.from("integration_sync_jobs").update({ status: "cancelled", last_error: detail, completed_at: new Date().toISOString() }).eq("connection_id", job.connection_id).in("status", ["queued", "failed"]).throwOnError();
        }
        await admin.from("integration_sync_jobs").update({
          status: policy.reconnectRequired ? "cancelled" : policy.retryable ? "failed" : "dead_letter",
          attempts: job.attempts + 1, last_error: detail,
          scheduled_for: new Date(Date.now() + Math.max(connectorRetryDelayMinutes(job.attempts+1)*60, policy.retryAfterSeconds ?? 0)*1000).toISOString(),
          locked_at: null, locked_by: null,
        }).eq("id", job.id).throwOnError();
        failed += 1;
        continue;
      }
    }
    let fieldMappings: ConnectorFieldMapping[];
    try {
      fieldMappings = await fieldMappingsFor(admin, job);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Could not load field mappings.";
      await admin
        .from("integration_sync_jobs")
        .update({
          status: job.attempts + 1 < job.maxAttempts ? "failed" : "dead_letter",
          attempts: job.attempts + 1,
          last_error: detail,
          scheduled_for: new Date(
            Date.now() + connectorRetryDelayMinutes(job.attempts + 1) * 60_000,
          ).toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id).throwOnError();
      failed += 1;
      continue;
    }
    const outcome = await executeConnectorSyncJob({
      adapter,
      context: {
        connectionId: job.connection_id,
        partnerId: job.partner_id,
        clientId: job.client_id,
        credentials,
        config: job.connection_config,
      },
      job,
      repository: repositoryFor(admin, job),
      fieldMappings,
    });
    if (outcome.ok) {
      if (job.direction === "push") {
        await admin
          .from("integration_events")
          .update({
            event_type: `connector.${job.objectType}_writeback_sent`,
            status: "sent",
            external_object_id:
              typeof outcome.result.externalObjectId === "string"
                ? outcome.result.externalObjectId
                : null,
            response_payload: outcome.result,
          })
          .eq("connection_id", job.connection_id)
          .eq("idempotency_key", String(job.payload.idempotencyKey ?? "")).throwOnError();
      }
      if (job.direction === "pull") {
        const nextCursor = outcome.result.nextCursor as Record<
          string,
          unknown
        > | null;
        const continueImmediately =
          outcome.result.continueImmediately === true;
        const { error: continuationError } = await admin.from("integration_sync_jobs").insert({
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          direction: "pull",
          object_type: job.objectType,
          operation: "sync",
          status: "queued",
          idempotency_key: `continue-${job.id}`,
          payload: nextCursor ? { cursor: nextCursor } : {},
          scheduled_for: continueImmediately
            ? new Date().toISOString()
            : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (continuationError && continuationError.code !== "23505") throw new Error("Connector continuation could not be persisted.");
      }
      await admin
        .from("integration_sync_jobs")
        .update({
          status: "succeeded",
          result: outcome.result,
          completed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id).throwOnError();
      succeeded += 1;
    } else {
      const attempts = job.attempts + 1;
      if (outcome.reconnectRequired) {
        const now = new Date().toISOString();
        await admin
          .from("integration_connections")
          .update({
            status: "needs_attention",
            credential_status: "invalid",
            health_summary: outcome.error,
            last_failure_at: now,
            last_checked_at: now,
          })
          .eq("id", job.connection_id).throwOnError();
        await admin
          .from("integration_sync_states")
          .update({
            status: "paused",
            last_error: outcome.error,
            lease_owner: null,
            lease_expires_at: null,
          })
          .eq("connection_id", job.connection_id).throwOnError();
        await admin
          .from("integration_sync_jobs")
          .update({
            status: "cancelled",
            last_error: outcome.error,
            completed_at: now,
            locked_at: null,
            locked_by: null,
          })
          .eq("connection_id", job.connection_id)
          .in("status", ["queued", "failed"]).throwOnError();
      }
      await admin
        .from("integration_sync_jobs")
        .update({
          status: outcome.reconnectRequired || outcome.cancelled
            ? "cancelled"
            : outcome.retryable
              ? "failed"
              : "dead_letter",
          attempts,
          last_error: outcome.error,
          scheduled_for: new Date(
            Date.now() + Math.max(connectorRetryDelayMinutes(attempts) * 60, outcome.retryAfterSeconds ?? 0) * 1000,
          ).toISOString(),
          locked_at: null,
          locked_by: null,
          completed_at: outcome.reconnectRequired
            ? new Date().toISOString()
            : null,
        })
        .eq("id", job.id).throwOnError();
      if (job.direction === "push") {
        await admin
          .from("integration_events")
          .update({
            event_type: `connector.${job.objectType}_writeback_failed`,
            status: "failed",
            error_message: outcome.error,
          })
          .eq("connection_id", job.connection_id)
          .eq("idempotency_key", String(job.payload.idempotencyKey ?? "")).throwOnError();
      }
      failed += 1;
    }
  }
  return {
    processed: succeeded + failed,
    succeeded,
    failed,
    recoveredPulls,
    uncertainPushes: uncertainPushes?.length ?? 0,
  };
}
