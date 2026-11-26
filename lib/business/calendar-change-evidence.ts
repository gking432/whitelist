import { verifiedCalendarReconciliation } from "../scheduling/calendar-reconciliation-rules.ts";
import type { CustomerJourneyStage, CustomerJourneyState } from "./customer-journey-contract.ts";
import type { JourneyRow } from "./customer-journey-data.ts";
import { CalendarMutationReceiptSchema, readCalendarMutationPayload, sameMutationSlot } from "../scheduling/calendar-mutation-rules.ts";
const str = (value: unknown) => typeof value === "string" ? value : "";
export function calendarChangeEvidence(approvals: JourneyRow[], jobs: JourneyRow[], nativeVersion: string | null, now: string) {
  const stages: CustomerJourneyStage[] = [], warnings: string[] = [];
  let active = false;
  for (const approval of approvals.slice(0, 12)) {
    const payload = readCalendarMutationPayload(approval.proposed_payload);
    if (!payload) { warnings.push("A saved calendar decision lacks usable source evidence. Review it before retrying."); continue; }
    const job = jobs.find((row) => row.approval_id === approval.id), receipt = CalendarMutationReceiptSchema.safeParse(job?.provider_receipt);
    const expired = approval.status === "pending" && !!approval.expires_at && Date.parse(str(approval.expires_at)) <= Date.parse(now);
    const providerProof = job?.kind === `calendar.${payload.mutation}` && job?.external_ref === payload.external_ref && receipt.success && receipt.data.provider === payload.provider && receipt.data.operation === payload.mutation && receipt.data.event_id === payload.external_ref &&
      Date.parse(receipt.data.verified_at) <= Date.parse(now) && sameMutationSlot(receipt.data.old_slot, payload.old_slot) &&
      (payload.provider === "northstar_internal" ? receipt.data.http_status === 0 : payload.mutation === "cancel" ? receipt.data.http_status === 204 && receipt.data.verified_absent : receipt.data.http_status === 200 && !receipt.data.verified_absent && !!receipt.data.event_updated_at && !!receipt.data.event_etag && !receipt.data.event_etag.startsWith("W/") && receipt.data.event_etag !== payload.source_etag) &&
      (payload.mutation === "cancel" ? receipt.data.new_slot === null : !!payload.new_slot && !!receipt.data.new_slot && sameMutationSlot(payload.new_slot, receipt.data.new_slot));
    const original = jobs.find((row) => row.id === payload.booking_action_job_id && row.kind === "calendar.book" && row.status === "succeeded");
    const reconciled = !!job && !!original && ["uncertain", "provider_pending"].includes(str(job.status)) &&
      !!job.calendar_reconciled_at && Date.parse(str(job.calendar_reconciled_at)) <= Date.parse(now) &&
      verifiedCalendarReconciliation({ jobId: str(job.id), approvalId: str(approval.id), previousStatus: job.status as "uncertain" | "provider_pending",
        attemptedAt: str(job.last_attempt_at ?? job.claimed_at) || null, bookingReceiptAt: str(original.receipt_recorded_at) || null, payload }, job.calendar_reconciliation, now);
    const state: CustomerJourneyState = approval.status === "pending" ? expired ? "review" : "needs_owner" :
      ["rejected", "expired", "cancelled"].includes(str(approval.status)) ? "cancelled" :
        reconciled ? "confirmed" : job?.status === "succeeded" ? providerProof ? "confirmed" : "review" : ["processing", "provider_pending"].includes(str(job?.status)) ? "provider_pending" :
          ["failed", "uncertain", "skipped", "dry_run", "cancelled"].includes(str(job?.status)) ? "review" : "queued";
    const label = payload.mutation === "cancel" ? "Cancellation" : "Time change";
    const times = payload.mutation === "cancel" ? `for ${payload.old_slot.start_iso}` : `from ${payload.old_slot.start_iso} to ${payload.new_slot!.start_iso}`;
    const summary = reconciled ? `${label} source state independently verified. The original ${str(job?.status).replaceAll("_", " ")} write result is retained; no calendar change was repeated or attributed to that attempt.` : state === "confirmed" ? `${label} ${times} verified by ${payload.provider === "northstar_internal" ? "the internal calendar transaction" : "the source calendar response and readback"}.` :
      state === "needs_owner" ? `Review ${label.toLowerCase()} ${times}. The appointment is unchanged until an approved action is verified.` :
        state === "provider_pending" ? `${label} ${times} is processing or provider-pending. Do not repeat it.` :
          state === "queued" ? `${label} approved; waiting for the guarded calendar action. No result is verified yet.` :
            state === "cancelled" ? `${label} decision was declined or retired; no change is established by that decision.` :
              str(job?.outcome_detail) || `${label} ${times} needs review. A failed or uncertain request is not a verified change.`;
    stages.push({ key: payload.mutation === "cancel" ? "cancellation" : "time_change", status: state, summary,
      updatedAt: str(job?.calendar_reconciled_at ?? job?.receipt_recorded_at ?? approval.updated_at) || null,
      sources: [{ kind: "approval", id: str(approval.id), href: "/client/approvals" }, ...(job ? [{ kind: "calendar_change_receipt", id: str(job.id) }] : [])], href: "/client/approvals" });
    if (job?.calendar_reconcile_reason) warnings.push(`Calendar result retained; saved appointment review needed. ${str(job.calendar_reconcile_reason)}`);
    if (!reconciled && (["processing", "provider_pending", "uncertain"].includes(str(job?.status)) || (job?.status === "failed" && !!job?.external_ref) ||
      (payload.appointment_updated_at === nativeVersion && ((approval.status === "pending" && !expired) || ["pending", "succeeded"].includes(str(job?.status)))))) active = true;
  }
  return { stages, warnings, active };
}
