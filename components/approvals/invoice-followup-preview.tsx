import { formatMinorMoney } from "@/lib/connections/money";
import { readInvoiceFollowupPin } from "@/lib/money/eligibility";
import { invoiceReviewTime, invoiceSourceHref } from "@/lib/money/presentation";

export function InvoiceFollowupPreview({ payload }: { payload: unknown }) {
  const invoice = readInvoiceFollowupPin(payload);
  if (!invoice) return <p role="alert" className="mt-4 text-sm text-destructive">The exact invoice and recipient details are unavailable. Reject this proposal and prepare a fresh source review.</p>;
  const sourceHref = invoiceSourceHref(invoice.hosted_invoice_url);
  return <section className="mt-4 space-y-3 rounded-md border bg-secondary/30 p-4 text-sm" aria-label="Invoice reminder source review">
    <h3 className="font-medium">Invoice reminder for approval</h3>
    <dl className="space-y-2">
      <div><dt className="font-medium">Invoice</dt><dd className="break-words">{invoice.invoice_number || invoice.invoice_id}</dd></div>
      <div><dt className="font-medium">Remaining amount</dt><dd>{formatMinorMoney(invoice.amount_due_minor, invoice.currency) ?? "Amount unavailable"} · {invoice.currency}</dd></div>
      <div><dt className="font-medium">Invoice total / recorded paid</dt><dd>{formatMinorMoney(invoice.total_minor, invoice.currency) ?? "Total unavailable"} / {formatMinorMoney(invoice.amount_paid_minor, invoice.currency) ?? "Paid amount unavailable"}</dd></div>
      <div><dt className="font-medium">Due (UTC)</dt><dd>{invoiceReviewTime(invoice.due_at, "UTC") || "Due date unavailable"}</dd></div>
      <div><dt className="font-medium">Selected email recipient</dt><dd className="break-all">{invoice.to}</dd></div>
      <div><dt className="font-medium">Stripe account</dt><dd className="break-all">{invoice.stripe_account_id}</dd></div>
    </dl>
    {sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="inline-block underline">Open source invoice ↗</a> : null}
    <p className="text-xs leading-6 text-muted-foreground">Approval authorizes this exact reminder. The current invoice balance, source account, verified conversation and outreach permissions are checked again before delivery. Approval does not establish sending or payment.</p>
  </section>;
}
