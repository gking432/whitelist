export type InvoiceReviewSource = {
  id: string; connectionId: string; externalId: string; revision: string; account: string;
  number: string | null; status: string; currency: string | null; amountDueMinor: number | null;
  totalMinor: number | null; dueAt: string | null; href: string | null; observedAt: string | null;
};
export type InvoiceReviewRecipient = {
  conversationId: string; contactId: string; name: string; email: string; account: string; revision: string;
};
export type InvoiceFollowupReview = {
  version: 1; invoice: InvoiceReviewSource; canWrite: boolean; eligible: boolean; blockReason: string | null;
  recipients: InvoiceReviewRecipient[]; recipientCoverageComplete: boolean;
  existing: { approvalId: string | null; taskId: string | null; status: string; detail: string } | null;
};
export type InvoiceFollowupCommand = {
  action: "prepare_invoice_followup" | "handoff_invoice_followup";
  key: string; targetId: string; connectionId: string; expectedRevision: string;
  recipientConversationId?: string; expectedRecipientRevision?: string;
  identityConfirmed?: true; outreachPermissionConfirmed?: true; note?: string;
};
export type InvoiceFollowupReceipt = {
  id: string; sourceRecordId: string; taskId: string; approvalId: string | null; replayed: boolean; message: string;
};
/** Immutable owner decision and invoice pins ride the existing customer-message approval. */
export type InvoiceFollowupPin = {
  invoice_followup_version: 1; money_review_id: string;
  source_record_id: string; source_updated_at: string; source_external_updated_at: string | null;
  stripe_connection_id: string; stripe_account_id: string; invoice_id: string; stripe_customer_id: string;
  amount_due_minor: number; amount_paid_minor: number; total_minor: number; currency: string;
  due_at: string; collection_method: "send_invoice"; hosted_invoice_url: string | null; invoice_number: string | null;
  contact_id: string; contact_updated_at: string; channel: "email"; to: string; connection_id: string;
  authority_revision: number; customer_activity_id: string | null; customer_activity_at: string | null;
  conversation_id: string; conversation_revision: number;
};
