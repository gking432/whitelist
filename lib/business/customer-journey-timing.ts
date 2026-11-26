import type { CustomerJourney } from "./customer-journey-contract.ts";

/** Measured intervals between saved timestamps, not attribution or time saved. */
export function customerJourneyTiming(input: {
  now: string;
  inquiry?: { id: string; receivedAt: string | null };
  bookingReceipt?: { id: string; recordedAt: string | null };
  pendingDecision?: { id: string; createdAt: string | null; expiresAt: string | null };
}): NonNullable<CustomerJourney["observations"]> {
  const measured: NonNullable<CustomerJourney["observations"]> = [];
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return measured;
  const interval = (start: string | null | undefined, end: string | null | undefined) => {
    const from = Date.parse(start ?? ""), until = Date.parse(end ?? "");
    return Number.isFinite(from) && Number.isFinite(until) && from <= until && until <= now ? Math.floor((until - from) / 1000) : null;
  };
  const duration = interval(input.inquiry?.receivedAt, input.bookingReceipt?.recordedAt);
  if (duration !== null && input.inquiry && input.bookingReceipt) measured.push({
    key: "recorded_inquiry_to_booking", label: "Recorded inquiry to booking receipt", seconds: duration,
    detail: "Elapsed time between the source submission timestamp and the durable booking receipt. It includes unobserved/manual waiting; it is not time saved or software attribution.",
    sources: [{ kind: "source", id: input.inquiry.id }, { kind: "booking_receipt", id: input.bookingReceipt.id }],
  });
  const decision = input.pendingDecision;
  const waiting = interval(decision?.createdAt, input.now);
  if (decision && waiting !== null && (!decision.expiresAt || Date.parse(decision.expiresAt) > now)) measured.push({
    key: "booking_decision_wait", label: "Waiting for booking decision", seconds: waiting,
    detail: "Age of this pending saved decision in the loaded records. Other customer activity may exist.",
    sources: [{ kind: "approval", id: decision.id, href: "/client/approvals" }],
  });
  return measured;
}
