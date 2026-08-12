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
import type { CanonicalRecord } from "./types";

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
    .maybeSingle();
  if (!client || !shouldProjectConnectorRecord(client.crm_operating_mode)) {
    return null;
  }

  const { data: existingLink } = await admin
    .from("integration_object_links")
    .select("native_object_id")
    .eq("connection_id", job.connection_id)
    .eq("object_type", record.objectType)
    .eq("external_object_id", record.externalId)
    .maybeSingle();

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
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId && contactValues.phone) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("phone", contactValues.phone)
        .limit(1)
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (contactId) {
      await admin
        .from("crm_contacts")
        .update(contactValues)
        .eq("id", contactId)
        .eq("client_id", job.client_id);
    } else {
      const { data } = await admin
        .from("crm_contacts")
        .insert(contactValues)
        .select("id")
        .single();
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
        .maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId && phone) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", job.client_id)
        .eq("phone", phone)
        .limit(1)
        .maybeSingle();
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
        .single();
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
        .eq("client_id", job.client_id);
    } else {
      const { data } = await admin
        .from("crm_leads")
        .insert(leadValues)
        .select("id")
        .single();
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
        .maybeSingle();
      appointmentId = data?.id ?? null;
    }
    if (appointmentId) {
      await admin
        .from("crm_appointments")
        .update(appointmentValues)
        .eq("id", appointmentId)
        .eq("client_id", job.client_id);
    } else {
      const { data } = await admin
        .from("crm_appointments")
        .insert(appointmentValues)
        .select("id")
        .single();
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
        .eq("client_id", job.client_id);
    else {
      const { data } = await admin
        .from("crm_feedback")
        .insert(feedbackValues)
        .select("id")
        .single();
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
      .single();
    return data?.id ?? null;
  }
  return null;
}

function repositoryFor(admin: SupabaseClient, job: JobRow) {
  return {
    async saveCanonicalRecord(record: CanonicalRecord) {
      const nativeObjectId = await projectCanonicalRecord(admin, job, record);
      await admin.from("integration_canonical_records").upsert(
        {
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          object_type: record.objectType,
          external_object_id: record.externalId,
          external_parent_id: record.externalParentId ?? null,
          canonical_data: record.data,
          source_payload: record.source,
          external_updated_at: record.updatedAt ?? null,
          native_object_id: nativeObjectId,
          projection_status: nativeObjectId ? "projected" : "skipped",
          projection_error: null,
          projected_at: nativeObjectId ? new Date().toISOString() : null,
        },
        { onConflict: "connection_id,object_type,external_object_id" },
      );
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
        );
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
      );
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
      );
    },
  };
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
    const idempotencyKey = `initial-${objectType}`;
    const { data: existing } = await admin
      .from("integration_sync_jobs")
      .select("id")
      .eq("connection_id", scope.connectionId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) continue;
    await admin.from("integration_sync_jobs").insert({
      partner_id: scope.partnerId,
      client_id: scope.clientId,
      connection_id: scope.connectionId,
      direction: "pull",
      object_type: objectType,
      operation: "sync",
      status: "queued",
      idempotency_key: idempotencyKey,
      payload: {},
      scheduled_for: new Date().toISOString(),
    });
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
    .or(`locked_at.is.null,locked_at.lt.${staleCutoff}`);

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
      .maybeSingle();
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
    .select("connection_id, object_type, payload");

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
      .eq("idempotency_key", String(stale.payload?.idempotencyKey ?? ""));
  }

  const { data } = await admin
    .from("integration_sync_jobs")
    .select(
      "*, connection:integration_connections!inner(config, status, runtime_mode, provider:integration_providers!inner(provider_key))",
    )
    .in("status", ["queued", "failed"])
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  for (const raw of data ?? []) {
    const connection = raw.connection as unknown as {
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
        .eq("id", job.id);
      failed += 1;
      continue;
    }
    if (
      job.direction === "push" &&
      (job.connection_status !== "connected" ||
        job.connection_runtime_mode !== "live")
    ) {
      await admin
        .from("integration_sync_jobs")
        .update({
          status: "cancelled",
          last_error:
            "Write-back cancelled because the connection is not connected and live.",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      await admin
        .from("integration_events")
        .update({
          event_type: `connector.${job.objectType}_writeback_skipped`,
          status: "skipped",
          error_message:
            "Write-back skipped because the connection is not connected and live.",
        })
        .eq("connection_id", job.connection_id)
        .eq("idempotency_key", String(job.payload.idempotencyKey ?? ""));
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
      .maybeSingle();
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
          .eq("secret_kind", PROVIDER_CREDENTIALS_KIND);
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : "Provider token refresh failed.";
        await admin
          .from("integration_connections")
          .update({
            status: "needs_attention",
            credential_status: "invalid",
            health_summary: detail,
            last_failure_at: new Date().toISOString(),
          })
          .eq("id", job.connection_id);
        await admin
          .from("integration_sync_jobs")
          .update({
            status: "failed",
            attempts: job.attempts + 1,
            last_error: detail,
            scheduled_for: new Date(
              Date.now() +
                connectorRetryDelayMinutes(job.attempts + 1) * 60_000,
            ).toISOString(),
            locked_at: null,
            locked_by: null,
          })
          .eq("id", job.id);
        failed += 1;
        continue;
      }
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
    });
    if (outcome.ok) {
      await admin
        .from("integration_sync_jobs")
        .update({
          status: "succeeded",
          result: outcome.result,
          completed_at: new Date().toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id);
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
          .eq("idempotency_key", String(job.payload.idempotencyKey ?? ""));
      }
      if (job.direction === "pull") {
        const nextCursor = outcome.result.nextCursor as Record<
          string,
          unknown
        > | null;
        await admin.from("integration_sync_jobs").insert({
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          direction: "pull",
          object_type: job.objectType,
          operation: "sync",
          status: "queued",
          idempotency_key: `continue-${job.id}`,
          payload: nextCursor ? { cursor: nextCursor } : {},
          scheduled_for: nextCursor
            ? new Date().toISOString()
            : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
      }
      succeeded += 1;
    } else {
      const attempts = job.attempts + 1;
      await admin
        .from("integration_sync_jobs")
        .update({
          status: outcome.retryable ? "failed" : "dead_letter",
          attempts,
          last_error: outcome.error,
          scheduled_for: new Date(
            Date.now() + connectorRetryDelayMinutes(attempts) * 60_000,
          ).toISOString(),
          locked_at: null,
          locked_by: null,
        })
        .eq("id", job.id);
      if (job.direction === "push") {
        await admin
          .from("integration_events")
          .update({
            event_type: `connector.${job.objectType}_writeback_failed`,
            status: "failed",
            error_message: outcome.error,
          })
          .eq("connection_id", job.connection_id)
          .eq("idempotency_key", String(job.payload.idempotencyKey ?? ""));
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
