import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { redactAuditValue } from "@/lib/audit/redact";
import { decryptSecret, encryptSecret } from "@/lib/integrations/secrets";

export type InboundEventInput = {
  partnerId: string;
  clientId: string;
  connectionId: string | null;
  eventType: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
  handler?: "workflow" | "phone";
};
export type InboundReceipt = { eventId: string; duplicate: boolean; status: string };

export async function enqueueInboundEvent(admin: SupabaseClient, input: InboundEventInput): Promise<InboundReceipt> {
  const { data, error } = await admin.rpc("enqueue_inbound_event", {
    p_partner_id: input.partnerId,
    p_client_id: input.clientId,
    p_connection_id: input.connectionId,
    p_event_type: input.eventType,
    p_idempotency_key: input.idempotencyKey,
    p_redacted_payload: redactAuditValue({ event_type: input.eventType, data: input.data }),
    p_encrypted_payload: encryptSecret(JSON.stringify(input.data)),
    p_handler: input.handler ?? "workflow",
  });
  if (error || !data?.eventId) throw new Error("Inbound event could not be committed to the durable queue.");
  return data as InboundReceipt;
}

type InboundJob = {
  id: string; event_id: string; partner_id: string; client_id: string; connection_id: string | null;
  handler: "workflow" | "phone"; encrypted_payload: string; attempts: number; max_attempts: number;
};

export async function processInboundEventJobs(admin: SupabaseClient, limit = 10, eventId?: string) {
  const workerId = randomUUID();
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const { data, error } = await admin.rpc("claim_inbound_event_job", { p_worker_id: workerId, p_event_id: eventId ?? null });
    if (error) throw new Error("Inbound worker could not claim queued events.");
    const job = (data as InboundJob[] | null)?.[0];
    if (!job) break;
    try {
      if (job.connection_id) {
      const { data: connection } = await admin.from("integration_connections").select("status")
        .eq("id", job.connection_id).eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle().throwOnError();
      if (!connection || ["paused", "disabled"].includes(connection.status)) {
        await admin.from("inbound_event_jobs").update({ status: "cancelled", encrypted_payload: null, completed_at: new Date().toISOString(), locked_at: null, worker_id: null, last_error: "Connection was paused or disabled before processing." }).eq("id", job.id).eq("worker_id", workerId).throwOnError();
        continue;
      }
      } else {
        const { data: client } = await admin.from("client_businesses").select("status,native_lifecycle_enabled_at,default_runtime_mode,crm_operating_mode")
          .eq("id", job.client_id).eq("partner_id", job.partner_id).single().throwOnError();
        if (client.status !== "active" || !client.native_lifecycle_enabled_at || client.default_runtime_mode !== "live" ||
            !["primary_crm", "mirror", "assist"].includes(client.crm_operating_mode)) {
          await admin.from("inbound_event_jobs").update({ status: "cancelled", encrypted_payload: null, completed_at: new Date().toISOString(), locked_at: null, worker_id: null, last_error: "Native CRM automation is no longer enabled for this client." }).eq("id", job.id).eq("worker_id", workerId).throwOnError();
          continue;
        }
      }
      const { data: event } = await admin.from("integration_events").select("event_type")
        .eq("id", job.event_id).eq("partner_id", job.partner_id).eq("client_id", job.client_id).single().throwOnError();
      const payload = JSON.parse(decryptSecret(job.encrypted_payload)) as Record<string, unknown>;
      if (payload._embedded_binding_id) {
        const { data: binding } = await admin.from("embedded_solution_bindings").select("status,verified_at")
          .eq("id", String(payload._embedded_binding_id)).eq("connection_id", job.connection_id!)
          .eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle().throwOnError();
        const { data: source } = await admin.from("integration_connections").select("status,runtime_mode")
          .eq("id", job.connection_id!).eq("partner_id", job.partner_id).eq("client_id", job.client_id).single().throwOnError();
        const { data: client } = await admin.from("client_businesses").select("status,default_runtime_mode")
          .eq("id", job.client_id).eq("partner_id", job.partner_id).single().throwOnError();
        if (!binding || binding.status !== "enabled" || !binding.verified_at || source.status !== "connected" || source.runtime_mode !== "live" || client.status !== "active" || client.default_runtime_mode !== "live") {
          await admin.from("inbound_event_jobs").update({ status: "failed", available_at: new Date(Date.now()+300_000).toISOString(), locked_at: null, worker_id: null, attempts: Math.max(0,job.attempts-1), last_error: "Connected app solution is paused or no longer live; event held." }).eq("id", job.id).eq("worker_id", workerId).throwOnError();
          continue;
        }
      }
      let runId: string | null = null;
      if (job.handler === "phone") {
        if (!job.connection_id) throw new Error("Phone event requires a connection.");
        const { processPhoneProviderEvent } = await import("./phone-events");
        runId = await processPhoneProviderEvent(admin, { ...job, connection_id: job.connection_id, data: payload });
      } else {
        const { runWorkflowsForEvent } = await import("@/lib/workflows/engine");
        const result = await runWorkflowsForEvent(admin, {
          id: job.event_id, partnerId: job.partner_id, clientId: job.client_id,
          connectionId: job.connection_id, eventType: event.event_type, data: payload,
        });
        if (result.runs.some((run) => run.status === "failed")) throw new Error("A workflow failed; reconcile the existing run before retrying.");
        runId = result.runs[0]?.runId ?? null;
      }
      const { data: finished, error: finishError } = await admin.rpc("finish_inbound_event_job", { p_job_id: job.id, p_worker_id: workerId, p_workflow_run_id: runId });
      if (finishError || !finished) throw new Error("Inbound worker could not commit completion.");
      processed += 1;
    } catch {
      // Never replay a partial workflow automatically: a CRM write/notification
      // might have succeeded before the exception. Keep the encrypted payload
      // and event so operators can reconcile without asking the sender to resend.
      const { data: runs, error: runsError } = await admin.from("workflow_runs").select("id,status")
        .eq("trigger_event_id", job.event_id).eq("client_id", job.client_id);
      const uncertain = Boolean(runsError) || Boolean(runs?.some((run) => !["succeeded", "paused_for_approval"].includes(run.status)));
      const exhausted = job.attempts >= job.max_attempts;
      const detail = uncertain ? "Existing workflow needs reconciliation before replay; external effects may already exist." : "Inbound processing failed; queued for bounded retry.";
      await admin.from("inbound_event_jobs").update({ status: uncertain || exhausted ? "dead_letter" : "failed", available_at: new Date(Date.now() + Math.min(60, 2 ** job.attempts) * 60_000).toISOString(), locked_at: null, worker_id: null, last_error: detail, completed_at: uncertain || exhausted ? new Date().toISOString() : null }).eq("id", job.id).eq("worker_id", workerId).throwOnError();
      await admin.from("integration_events").update({ status: "failed", error_code: uncertain ? "reconciliation_required" : "queued_retry", error_message: detail }).eq("id", job.event_id).throwOnError();
      failed += 1;
    }
    if (eventId) break;
  }
  return { processed, failed };
}
