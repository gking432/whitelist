export type ApprovalSnapshot = {
  id: string;
  partner_id: string;
  client_id: string;
  status: string;
  type: string;
  resolved_content: string | null;
  proposed_payload: Record<string, unknown> | null;
};

/** Rebuild the execution from the immutable approval, never a retry payload. */
export function authorizedActionPayload(
  job: {
    approval_id: string | null;
    partner_id: string;
    client_id: string;
    kind: string;
  },
  approval: ApprovalSnapshot | null,
): Record<string, unknown> | null {
  if (
    !approval ||
    approval.id !== job.approval_id ||
    approval.partner_id !== job.partner_id ||
    approval.client_id !== job.client_id ||
    !["approved", "edited_and_approved"].includes(approval.status)
  )
    return null;
  const payload = approval.proposed_payload ?? {};
  if (job.kind === "external.action") return approval.type === "external_action" ? payload : null;
  if (job.kind === "calendar.book")
    return approval.type === "appointment_booking" ? payload : null;
  const channel = job.kind === "email.send" ? "email" : "sms";
  if (
    approval.type !== "customer_message" ||
    payload.channel !== channel ||
    !approval.resolved_content?.trim()
  )
    return null;
  return { ...payload, body: approval.resolved_content };
}

export function actionCanBeClaimed(status: string, manual = false): boolean {
  return [
    "pending",
    "failed",
    ...(manual ? ["dry_run", "skipped"] : []),
  ].includes(status);
}
