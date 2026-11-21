import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueInboundEvent } from "@/lib/integrations/inbound/queue";

type LifecycleCandidate = {
  partner_id: string;
  client_id: string;
  event_type: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
};

/** Reach native CRM lifecycle workflows through the same durable approval path. */
export async function produceNativeCrmLifecycleEvents(admin: SupabaseClient, limit = 50) {
  const { data, error } = await admin.rpc("native_crm_lifecycle_candidates", { p_limit: limit });
  if (error) throw new Error("Native CRM lifecycle candidates could not be loaded.");
  let queued = 0;
  let failed = 0;
  for (const candidate of (data ?? []) as LifecycleCandidate[]) {
    try {
      const receipt = await enqueueInboundEvent(admin, {
        partnerId: candidate.partner_id,
        clientId: candidate.client_id,
        connectionId: null,
        eventType: candidate.event_type,
        idempotencyKey: candidate.idempotency_key,
        data: candidate.payload,
      });
      if (!receipt.duplicate) queued += 1;
    } catch {
      // Nothing is marked produced before the queue transaction commits. A
      // transient failure remains eligible for the next scheduler invocation.
      failed += 1;
    }
  }
  return { queued, failed };
}
