import type { InvoiceFollowupCommand, InvoiceFollowupReceipt, InvoiceFollowupReview, InvoiceReviewRecipient } from "./contract.ts";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown) => typeof value === "string" && !!value.trim();
const nullableText = (value: unknown) => value === null || typeof value === "string";
const nullableId = (value: unknown) => value === null || (typeof value === "string" && uuid.test(value));
const minor = (value: unknown) => value === null || (typeof value === "number" && Number.isSafeInteger(value));

export function invoiceSourceHref(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function invoiceReviewTime(value: string | null, timeZone: string): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone };
  try { return new Intl.DateTimeFormat("en-US", options).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value)) + " UTC"; }
}

export function readInvoiceFollowupReview(value: unknown, binding: { recordId: string; connectionId: string }): InvoiceFollowupReview {
  const review = object(value), source = object(review.invoice), existing = review.existing === null ? null : object(review.existing);
  if (review.version !== 1 || source.id !== binding.recordId || source.connectionId !== binding.connectionId ||
      !uuid.test(binding.recordId) || !uuid.test(binding.connectionId) || !text(source.externalId) || !text(source.revision) ||
      !text(source.account) || !text(source.status) || ![source.number, source.currency, source.dueAt, source.href, source.observedAt].every(nullableText) ||
      ![source.amountDueMinor, source.totalMinor].every(minor) || typeof review.canWrite !== "boolean" || typeof review.eligible !== "boolean" ||
      !nullableText(review.blockReason) || typeof review.recipientCoverageComplete !== "boolean" || !Array.isArray(review.recipients) || review.recipients.length > 100 ||
      review.recipients.some((raw) => {
        const recipient = object(raw);
        return !uuid.test(String(recipient.conversationId)) || !uuid.test(String(recipient.contactId)) ||
          ![recipient.name, recipient.email, recipient.account, recipient.revision].every(text);
      }) || (existing && (!nullableId(existing.approvalId) || !nullableId(existing.taskId) || !text(existing.status) || !text(existing.detail))))
    throw new Error("The exact invoice review could not be confirmed. Refresh its source details before choosing a follow-up.");
  return value as InvoiceFollowupReview;
}

export function buildInvoiceFollowupCommand(
  review: InvoiceFollowupReview,
  action: InvoiceFollowupCommand["action"],
  key: string,
  values: { recipient?: InvoiceReviewRecipient | null; identityConfirmed?: boolean; outreachPermissionConfirmed?: boolean; sourceReviewed?: boolean; note?: string },
): InvoiceFollowupCommand {
  if (!review.canWrite || !uuid.test(key) || !uuid.test(review.invoice.id) || !uuid.test(review.invoice.connectionId) || !review.invoice.revision)
    throw new Error("Owner write access and a current invoice review are required.");
  const command: InvoiceFollowupCommand = { action, key, targetId: review.invoice.id, connectionId: review.invoice.connectionId, expectedRevision: review.invoice.revision };
  if (action === "prepare_invoice_followup") {
    const selected = values.recipient;
    const recipient = selected ? review.recipients.find((candidate) => candidate.conversationId === selected.conversationId &&
      candidate.contactId === selected.contactId && candidate.revision === selected.revision) : undefined;
    if (!review.eligible) throw new Error(review.blockReason || "This invoice needs manual source review before preparing a reminder.");
    if (!recipient || !values.identityConfirmed || !values.outreachPermissionConfirmed)
      throw new Error("Choose a verified conversation and explicitly confirm the customer and permission for this outreach.");
    return { ...command, recipientConversationId: recipient.conversationId, expectedRecipientRevision: recipient.revision, identityConfirmed: true, outreachPermissionConfirmed: true };
  }
  if (action !== "handoff_invoice_followup") throw new Error("Choose a supported invoice review action.");
  const note = values.note?.trim() || "";
  if (!values.sourceReviewed || note.length > 2000)
    throw new Error("Review the source and keep any manual follow-up note within 2,000 characters.");
  return note ? { ...command, note } : command;
}

export function readInvoiceFollowupReceipt(value: unknown, sourceRecordId: string): InvoiceFollowupReceipt {
  const receipt = object(value);
  if (!uuid.test(String(receipt.id)) || receipt.sourceRecordId !== sourceRecordId || !uuid.test(String(receipt.taskId)) ||
      !nullableId(receipt.approvalId) || typeof receipt.replayed !== "boolean" || !text(receipt.message))
    throw new Error("A saved invoice-review receipt was not confirmed. Check this same request again.");
  return value as InvoiceFollowupReceipt;
}
