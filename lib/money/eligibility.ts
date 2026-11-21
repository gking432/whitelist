import type { InvoiceFollowupPin } from "./contract.ts";
import { knownCurrency } from "../connections/money.ts";

const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const timestamp = (value: unknown): value is string => typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
const integer = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown, limit: number): value is string | null => value === null || typeof value === "string" && value.length > 0 && value.length <= limit;
const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);

function invoiceLink(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 3000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "invoice.stripe.com" && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** Only a live, overdue, manually payable invoice can produce this one-off
 * reminder. Imported email/customer names never establish recipient identity. */
export function invoiceFollowupEligibilityBlock(facts: unknown, nowIso: string): string | null {
  const invoice = object(facts);
  if (!invoice || !timestamp(nowIso)) return "Current invoice facts or their observation clock are unavailable.";
  if (invoice.deleted === true || invoice.status !== "open") return "This invoice is no longer open. Nothing should be requested from the customer.";
  if (invoice.livemode !== true || invoice.collection_method !== "send_invoice") return "Only a live invoice that requests manual payment is eligible for this reminder.";
  if (!integer(invoice.amount_due_minor) || invoice.amount_due_minor === 0 || !integer(invoice.amount_paid_minor) || !integer(invoice.total_minor))
    return "A positive remaining balance and complete integer minor-unit amounts are required.";
  if (typeof invoice.currency !== "string" || knownCurrency(invoice.currency) !== invoice.currency)
    return "The invoice currency is unavailable or needs review.";
  if (typeof invoice.customer_id !== "string" || !/^cus_[A-Za-z0-9_]{1,250}$/.test(invoice.customer_id)) return "The exact Stripe customer identifier is unavailable.";
  if (!timestamp(invoice.due_date) || Date.parse(invoice.due_date) > Date.parse(nowIso)) return "The invoice has no verified overdue date.";
  if (!invoiceLink(invoice.hosted_url) || !nullableText(invoice.number, 500)) return "The saved invoice number or hosted invoice link needs review.";
  return null;
}

/** Reject malformed money markers instead of falling back to generic delivery. */
export function readInvoiceFollowupPin(value: unknown): InvoiceFollowupPin | null {
  const p = object(value);
  if (!p || p.invoice_followup_version !== 1 || p.channel !== "email" || p.collection_method !== "send_invoice" ||
      ![p.money_review_id, p.source_record_id, p.stripe_connection_id, p.contact_id, p.connection_id, p.conversation_id].every(uuid) ||
      ![p.source_updated_at, p.contact_updated_at, p.due_at].every(timestamp) ||
      !(p.source_external_updated_at === null || timestamp(p.source_external_updated_at)) ||
      !integer(p.authority_revision) || !integer(p.conversation_revision) ||
      !integer(p.amount_due_minor) || p.amount_due_minor === 0 || !integer(p.amount_paid_minor) || !integer(p.total_minor) ||
      typeof p.currency !== "string" || knownCurrency(p.currency) !== p.currency ||
      typeof p.stripe_account_id !== "string" || !/^acct_[A-Za-z0-9_]{1,250}$/.test(p.stripe_account_id) ||
      typeof p.invoice_id !== "string" || !/^in_[A-Za-z0-9_]{1,250}$/.test(p.invoice_id) ||
      typeof p.stripe_customer_id !== "string" || !/^cus_[A-Za-z0-9_]{1,250}$/.test(p.stripe_customer_id) ||
      typeof p.to !== "string" || p.to.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.to) ||
      !invoiceLink(p.hosted_invoice_url) || !nullableText(p.invoice_number, 500) ||
      !(p.customer_activity_id === null && p.customer_activity_at === null || uuid(p.customer_activity_id) && timestamp(p.customer_activity_at))) return null;
  return p as InvoiceFollowupPin;
}

/** Compare the current exact invoice against the immutable financial decision;
 * a partial payment or any amount change requires a new owner review. */
export function invoiceFollowupSourceBlock(pin: InvoiceFollowupPin, currentFacts: unknown, nowIso: string): string | null {
  const blocked = invoiceFollowupEligibilityBlock(currentFacts, nowIso);
  if (blocked) return blocked;
  const facts = currentFacts as Record<string, unknown>;
  if (facts.customer_id !== pin.stripe_customer_id || facts.amount_due_minor !== pin.amount_due_minor ||
      facts.amount_paid_minor !== pin.amount_paid_minor || facts.total_minor !== pin.total_minor || facts.currency !== pin.currency ||
      !sameTime(String(facts.due_date), pin.due_at) || facts.hosted_url !== pin.hosted_invoice_url || facts.number !== pin.invoice_number)
    return "The current invoice differs from the reviewed balance, customer, date or link. Prepare a fresh owner review.";
  return null;
}
