export type ConfirmationSource = {
  approvalStatus: string; receiptStatus: string; externalRef: string | null;
  receiptAt: string; startAt: string; endAt: string; internal: boolean; optedOut: boolean;
  native: { id: string; status: string; startAt: string; endAt: string } | null;
  imports: { externalId: string; accountBound: boolean; observedAt: string; deleted: boolean; status: string; startAt: string; endAt: string; nativeId: string | null }[];
};
const epoch = (value: string) => Date.parse(value);
export function confirmationContactSuppressed(tags: unknown): boolean {
  return Array.isArray(tags) && tags.some((tag) => typeof tag === "string" &&
    ["do_not_contact", "opt_out", "opted_out", "unsubscribed", "stop"].includes(tag.trim().toLowerCase().replace(/[\s-]+/g, "_")));
}
export function bookingConfirmationBlock(source: ConfirmationSource, now: string): string | null {
  if (!["approved", "edited_and_approved"].includes(source.approvalStatus)) return "The original booking approval is no longer valid.";
  if (source.receiptStatus !== "succeeded" || !source.externalRef) return "The booking has no verified successful receipt. Do not send a confirmation.";
  if (source.optedOut) return "The customer opted out. No booking confirmation was sent.";
  if (![source.startAt, source.endAt, now].every((value) => Number.isFinite(epoch(value))) || epoch(source.startAt) <= epoch(now) || epoch(source.endAt) <= epoch(source.startAt))
    return "The booked time has passed or cannot be verified.";
  const sameSlot = (row: { startAt: string; endAt: string }) => epoch(row.startAt) === epoch(source.startAt) && epoch(row.endAt) === epoch(source.endAt);
  if (source.native && (source.native.status !== "booked" || !sameSlot(source.native))) return "The saved appointment was cancelled, rescheduled or changed. Review a new confirmation.";
  if (source.internal) return source.native ? null : "The internal booking receipt is unavailable.";
  if (!source.imports.length) return "Waiting for a current calendar import of the booked appointment before confirmation.";
  for (const row of source.imports) {
    if (!row.accountBound || row.externalId !== source.externalRef || (source.native && row.nativeId && row.nativeId !== source.native.id)) return "The calendar source does not match this booking and account.";
    if (row.deleted || ["cancelled", "canceled"].includes(row.status) || !sameSlot(row)) return "The source appointment was cancelled, deleted or rescheduled. Review a new confirmation.";
    if (!["confirmed", "booked"].includes(row.status)) return "The source calendar has not confirmed this appointment.";
    if (!Number.isFinite(epoch(row.observedAt)) || !Number.isFinite(epoch(source.receiptAt)) || epoch(row.observedAt) < epoch(source.receiptAt)) return "The calendar import predates the booking result. Refresh before confirming.";
    if (epoch(row.observedAt) > epoch(now) || epoch(now) - epoch(row.observedAt) > 45 * 60000) return "The source appointment is stale. Refresh the calendar before confirming.";
  }
  return null;
}
