import type { SupabaseClient } from "@supabase/supabase-js";
import { readBusinessContext } from "../business/context-data.ts";
import { buildManagerContext, summarizeBusinessContext } from "../business/context.ts";
import { readCustomerJourneys } from "../business/customer-journey-data.ts";

/** The manager uses the owner's canonical context loader; its current assignment is excluded from its own answer. */
export async function readManagerBusinessContext(
  admin: SupabaseClient,
  work: { id: string; partner_id: string; client_id: string },
  clock: () => Date = () => new Date(),
) {
  const snapshot = await readBusinessContext(admin, { partnerId: work.partner_id, clientId: work.client_id }, false, clock);
  const journeys = await readCustomerJourneys(admin, { partnerId: work.partner_id, clientId: work.client_id }, false).catch(() => null);
  const model = {
    ...buildManagerContext(snapshot, work.id),
    customer_journeys: journeys?.journeys.map((journey) => ({
      lead_id: journey.leadId, customer_id: journey.customer.id, customer_name: journey.customer.name,
      identity: journey.customer.identity, title: journey.title, warnings: journey.warnings,
      stages: journey.stages, next_decision: journey.nextAction,
    })) ?? [],
    customer_journey_coverage: journeys ? { generated_at: journeys.generatedAt, partial: journeys.limited, errors: journeys.errors }
      : { generated_at: null, partial: true, errors: ["Customer journey details could not be verified; do not infer their results from other records."] },
  };
  return {
    snapshot,
    model,
    summary: summarizeBusinessContext(snapshot, work.id),
    evidence: {
      context_revision: snapshot.revision,
      authority_revision: snapshot.authority.revision,
      context_generated_at: snapshot.generatedAt,
      sources: model.records.flatMap((record) => record.sources).slice(0, 120),
    },
  };
}
