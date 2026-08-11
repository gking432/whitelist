import type { SupabaseClient } from "@supabase/supabase-js";

import { readProviderCredentials } from "@/lib/integrations/credentials";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import { getConnectorAdapter } from "./adapters";
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
  if (!client || client.crm_operating_mode === "external_crm") return null;

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
      const { data } = await admin.from("crm_contacts").select("id")
        .eq("client_id", job.client_id).eq("email", contactValues.email).limit(1).maybeSingle();
      contactId = data?.id ?? null;
    }
    if (!contactId && contactValues.phone) {
      const { data } = await admin.from("crm_contacts").select("id")
        .eq("client_id", job.client_id).eq("phone", contactValues.phone).limit(1).maybeSingle();
      contactId = data?.id ?? null;
    }
    if (contactId) {
      await admin.from("crm_contacts").update(contactValues).eq("id", contactId).eq("client_id", job.client_id);
    } else {
      const { data } = await admin.from("crm_contacts").insert(contactValues).select("id").single();
      contactId = data?.id ?? null;
    }
    return contactId;
  }

  if (record.objectType === "appointment") {
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
      status: statusValue === "cancelled" ? "cancelled" : "booked",
      external_ref: record.externalId,
      source: job.provider?.provider_key ?? "external_sync",
      notes: value(record.data, "description"),
    };
    let appointmentId = existingLink?.native_object_id ?? null;
    if (!appointmentId) {
      const { data } = await admin.from("crm_appointments").select("id")
        .eq("client_id", job.client_id).eq("external_ref", record.externalId).limit(1).maybeSingle();
      appointmentId = data?.id ?? null;
    }
    if (appointmentId) {
      await admin.from("crm_appointments").update(appointmentValues).eq("id", appointmentId).eq("client_id", job.client_id);
    } else {
      const { data } = await admin.from("crm_appointments").insert(appointmentValues).select("id").single();
      appointmentId = data?.id ?? null;
    }
    return appointmentId;
  }
  return null;
}

function repositoryFor(admin: SupabaseClient, job: JobRow) {
  return {
    async saveCanonicalRecord(record: CanonicalRecord) {
      const nativeObjectId = await projectCanonicalRecord(admin, job, record);
      await admin.from("integration_canonical_records").upsert({
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
      }, { onConflict: "connection_id,object_type,external_object_id" });
      if (nativeObjectId) {
        await admin.from("integration_object_links").upsert({
          partner_id: job.partner_id,
          client_id: job.client_id,
          connection_id: job.connection_id,
          object_type: record.objectType,
          native_object_id: nativeObjectId,
          external_object_id: record.externalId,
          external_parent_id: record.externalParentId ?? null,
          external_updated_at: record.updatedAt ?? null,
          last_synced_at: new Date().toISOString(),
        }, { onConflict: "connection_id,object_type,native_object_id" });
      }
    },
    async saveCursor(cursor: Record<string, unknown> | null) {
      await admin.from("integration_sync_states").upsert({
        partner_id: job.partner_id,
        client_id: job.client_id,
        connection_id: job.connection_id,
        stream_key: job.objectType,
        cursor_value: cursor,
        status: "idle",
        last_completed_at: new Date().toISOString(),
        last_error: null,
      }, { onConflict: "connection_id,stream_key" });
    },
    async saveObjectLink(input: {
      objectType: string;
      nativeObjectId: string;
      externalObjectId: string;
      externalParentId?: string | null;
      externalUpdatedAt?: string | null;
    }) {
      await admin.from("integration_object_links").upsert({
        partner_id: job.partner_id,
        client_id: job.client_id,
        connection_id: job.connection_id,
        object_type: input.objectType,
        native_object_id: input.nativeObjectId,
        external_object_id: input.externalObjectId,
        external_parent_id: input.externalParentId ?? null,
        external_updated_at: input.externalUpdatedAt ?? null,
        last_synced_at: new Date().toISOString(),
      }, { onConflict: "connection_id,object_type,native_object_id" });
    },
  };
}

export async function enqueueInitialWorkspaceSync(
  admin: SupabaseClient,
  scope: { partnerId: string; clientId: string; connectionId: string },
) {
  for (const objectType of ["customer", "appointment", "message"] as const) {
    const idempotencyKey = `initial-${objectType}`;
    const { data: existing } = await admin.from("integration_sync_jobs")
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
  if (!admin) return { processed: 0, succeeded: 0, failed: 0 };
  const { data } = await admin.from("integration_sync_jobs")
    .select("*, connection:integration_connections!inner(config, provider:integration_providers!inner(provider_key))")
    .in("status", ["queued", "failed"])
    .lte("scheduled_for", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit);

  let succeeded = 0;
  let failed = 0;
  for (const raw of data ?? []) {
    const connection = raw.connection as unknown as { config?: Record<string, unknown>; provider?: { provider_key: string } };
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
    } as JobRow;
    const adapter = job.provider ? getConnectorAdapter(job.provider.provider_key) : null;
    if (!adapter) {
      await admin.from("integration_sync_jobs").update({ status: "dead_letter", last_error: "Connector adapter is unavailable." }).eq("id", job.id);
      failed += 1;
      continue;
    }
    const claimed = await admin.from("integration_sync_jobs").update({ status: "running", locked_at: new Date().toISOString(), locked_by: "cron" })
      .eq("id", job.id).in("status", ["queued", "failed"]).select("id").maybeSingle();
    if (!claimed.data) continue;
    const credentials = await readProviderCredentials<unknown>(admin, job.connection_id);
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
      await admin.from("integration_sync_jobs").update({ status: "succeeded", result: outcome.result, completed_at: new Date().toISOString(), locked_at: null, locked_by: null }).eq("id", job.id);
      if (job.direction === "pull") {
        const nextCursor = outcome.result.nextCursor as Record<string, unknown> | null;
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
      await admin.from("integration_sync_jobs").update({
        status: outcome.retryable ? "failed" : "dead_letter",
        attempts,
        last_error: outcome.error,
        scheduled_for: new Date(Date.now() + connectorRetryDelayMinutes(attempts) * 60_000).toISOString(),
        locked_at: null,
        locked_by: null,
      }).eq("id", job.id);
      failed += 1;
    }
  }
  return { processed: succeeded + failed, succeeded, failed };
}
