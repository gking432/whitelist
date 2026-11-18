"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { InvoiceFollowupCommand, InvoiceFollowupReceipt, InvoiceFollowupReview, InvoiceReviewRecipient } from "@/lib/money/contract";
import { buildInvoiceFollowupCommand, invoiceReviewTime, invoiceSourceHref, readInvoiceFollowupReceipt, readInvoiceFollowupReview } from "@/lib/money/presentation";
import { formatMinorMoney } from "@/lib/connections/money";
import { BusinessDialog, buttonClass, inputClass, secondaryClass } from "./record-editor";

export function InvoiceFollowup({ connectionId, recordId, timeZone, available = true }: { connectionId: string; recordId: string; timeZone: string; available?: boolean }) {
  const router = useRouter();
  const recipientName = useId();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<InvoiceFollowupReview | null>(null);
  const [recipient, setRecipient] = useState<InvoiceReviewRecipient | null>(null);
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [outreachPermissionConfirmed, setOutreachPermissionConfirmed] = useState(false);
  const [sourceReviewed, setSourceReviewed] = useState(false);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState(false);
  const [receipt, setReceipt] = useState<InvoiceFollowupReceipt | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<InvoiceFollowupCommand | null>(null);
  const readLock = useRef(false), saveLock = useRef(false);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);

  async function load() {
    if (readLock.current || saveLock.current || pending.current) return;
    readLock.current = true;
    const version = ++generation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/business/invoice-follow-up?${new URLSearchParams({ connectionId, recordId })}`, { cache: "no-store", signal: requestController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The invoice source could not be checked.");
      const current = readInvoiceFollowupReview(data, { recordId, connectionId });
      if (!requestController.signal.aborted && version === generation.current) setReview(current);
    } catch (cause) {
      if (!requestController.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : "The invoice review is unavailable.");
    } finally {
      if (version === generation.current) { readLock.current = false; setLoading(false); }
    }
  }
  function startReview() {
    if (saveLock.current || readLock.current) return;
    pending.current = null;
    setPendingAttempt(false);
    setRecipient(null);
    setIdentityConfirmed(false);
    setOutreachPermissionConfirmed(false);
    setSourceReviewed(false);
    setNote("");
    setReview(null);
    void load();
  }
  async function save(request: InvoiceFollowupCommand) {
    if (saveLock.current || readLock.current) return;
    saveLock.current = true;
    pending.current = request;
    setPendingAttempt(true);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/business/invoice-follow-up", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The follow-up review could not be confirmed as saved.");
      const saved = readInvoiceFollowupReceipt(data.result, request.targetId);
      setReceipt(saved);
      pending.current = null;
      setPendingAttempt(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved result could not be confirmed. Check this same request again.");
    } finally { saveLock.current = false; setSaving(false); }
  }
  function submit(action: InvoiceFollowupCommand["action"]) {
    if (!review || saveLock.current || readLock.current || pending.current) return;
    try { void save(buildInvoiceFollowupCommand(review, action, crypto.randomUUID(), { recipient, identityConfirmed, outreachPermissionConfirmed, sourceReviewed, note })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Review the current invoice and follow-up choice."); }
  }
  const source = review?.invoice;
  const sourceHref = source ? invoiceSourceHref(source.href) : null;
  if (!available && !pendingAttempt && !receipt && !open) return null;
  return <>
    <button type="button" className="mt-3 min-h-10 rounded-lg border px-3 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setOpen(true); if (!review && !pending.current && !receipt) void load(); }}>
      {receipt ? "View saved follow-up" : pendingAttempt ? "Check saved review" : "Review follow-up"}
    </button>
    {open ? <BusinessDialog title="Review invoice follow-up" onClose={() => setOpen(false)}><div className="space-y-6">
      <p className="text-sm leading-7 text-slate-600">Review the invoice in its source before contacting anyone. Invoice names or email addresses do not establish customer identity or permission for outreach.</p>
      {error ? <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm leading-6 text-red-800">{error}</p> : null}
      {receipt ? <section className="space-y-3" aria-label="Saved invoice follow-up"><p role="status" className="text-sm leading-7">{receipt.replayed ? "Previously saved: " : ""}{receipt.message}</p><div className="flex flex-wrap gap-4 text-sm"><Link href="/client/todo" className="underline">Open To-do</Link>{receipt.approvalId ? <Link href="/client/approvals" className="underline">Review approval</Link> : null}</div><p className="text-xs leading-6 text-slate-500">A saved approval or handoff does not establish email delivery or payment.</p></section> : <>
        {loading ? <p role="status" className="text-sm text-slate-500">Loading the current invoice and verified conversation choices…</p> : null}
        {source ? <section className="rounded-xl border p-4" aria-label="Invoice source facts"><h3 className="font-medium">{source.number ? `Invoice ${source.number}` : "Invoice"}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{source.account} · {source.status.replaceAll("_", " ")}</p><dl className="mt-3 space-y-2 text-sm leading-6"><div><dt className="text-xs text-slate-500">Amount due</dt><dd>{formatMinorMoney(source.amountDueMinor, source.currency) ?? "Amount or currency unavailable"}</dd></div><div><dt className="text-xs text-slate-500">Invoice total</dt><dd>{formatMinorMoney(source.totalMinor, source.currency) ?? "Total or currency unavailable"}</dd></div><div><dt className="text-xs text-slate-500">Due</dt><dd>{invoiceReviewTime(source.dueAt, timeZone) || "Not recorded"}</dd></div><div><dt className="text-xs text-slate-500">Source observed</dt><dd>{invoiceReviewTime(source.observedAt, timeZone) || "Observation time unavailable"}</dd></div></dl>{sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs underline">Open source invoice ↗</a> : <p className="mt-3 text-xs text-slate-500">A safe source link is unavailable. Check this invoice in its connected account.</p>}<p className="mt-3 text-xs leading-6 text-slate-500">These are the loaded source facts. Payment or invoice changes must be checked before delivery.</p></section> : null}
        {review?.blockReason ? <p className="text-sm leading-7 text-amber-800">{review.blockReason}</p> : null}
        {review?.existing ? <section className="space-y-2 text-xs leading-6" aria-label="Existing invoice follow-up"><p className="font-medium">Existing follow-up · {review.existing.status.replaceAll("_", " ")}</p><p>{review.existing.detail}</p><div className="flex flex-wrap gap-4">{review.existing.approvalId ? <Link href="/client/approvals" className="underline">Open existing approval</Link> : null}{review.existing.taskId ? <Link href="/client/todo" className="underline">Open existing To-do</Link> : null}</div></section> : null}
        {pendingAttempt ? <section className="space-y-3" aria-label="Unconfirmed save"><p className="text-sm leading-7">No saved receipt has been confirmed. Checking again keeps the exact reviewed request and key; it does not create a new follow-up decision.</p><button type="button" className={buttonClass} disabled={saving} onClick={() => { if (pending.current) void save(pending.current); }}>{saving ? "Checking…" : "Check saved request"}</button></section> : review?.canWrite ? <>
          {review.eligible ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit("prepare_invoice_followup"); }}>
            <fieldset className="space-y-3" disabled={saving || loading}><legend className="mb-3 text-sm font-medium">Verified customer conversation</legend><p className="text-xs leading-6 text-slate-500">Choose the customer deliberately. These choices come from verified conversations, not an email match on the invoice.</p>{review.recipients.map((choice) => <label key={choice.conversationId} className="flex items-start gap-3 rounded-xl border p-4 text-sm leading-6"><input type="radio" name={recipientName} checked={recipient?.conversationId === choice.conversationId} onChange={() => { setRecipient(choice); setIdentityConfirmed(false); setOutreachPermissionConfirmed(false); }} className="mt-1" /><span className="min-w-0 break-words">{choice.name}<span className="block text-xs text-slate-500">{choice.email} · {choice.account}</span></span></label>)}{!review.recipients.length ? <p className="text-xs leading-6 text-amber-800">No eligible verified email conversation is available. Use a manual handoff to review the customer and contact route.</p> : null}{!review.recipientCoverageComplete ? <p className="text-xs leading-6 text-amber-800">Conversation choices are a bounded or incomplete set. Other customer work may exist; use a handoff if the correct conversation is missing.</p> : null}<label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={identityConfirmed} disabled={!recipient} onChange={(event) => setIdentityConfirmed(event.target.checked)} className="mt-1" />I confirmed that this invoice belongs to the customer in the selected conversation.</label><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={outreachPermissionConfirmed} disabled={!recipient} onChange={(event) => setOutreachPermissionConfirmed(event.target.checked)} className="mt-1" />I confirmed permission to send this invoice reminder through the selected email conversation.</label></fieldset><p className="text-xs leading-6 text-slate-500">Prepare one email reminder for the existing approval inbox. Sending still requires approval, current source and recipient checks, and a verified delivery result.</p><button type="submit" className={buttonClass} disabled={saving || loading || !recipient || !identityConfirmed || !outreachPermissionConfirmed}>Prepare reminder for approval</button>
          </form> : null}
          <form className="space-y-4 border-t pt-5" onSubmit={(event) => { event.preventDefault(); submit("handoff_invoice_followup"); }}><h3 className="text-sm font-medium">Save a manual follow-up handoff</h3><p className="text-xs leading-6 text-slate-500">Save source-backed work in To-do. This does not select a customer, authorize outreach or send an email.</p><label className="block space-y-2 text-sm">What should be checked? (optional)<textarea className={inputClass} value={note} maxLength={2000} rows={3} onChange={(event) => setNote(event.target.value)} /></label><label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={sourceReviewed} onChange={(event) => setSourceReviewed(event.target.checked)} className="mt-1" />I reviewed the loaded invoice source facts and want to save a manual follow-up review.</label><button type="submit" className={secondaryClass} disabled={saving || loading || !sourceReviewed}>Save manual handoff</button></form>
        </> : review ? <p className="text-sm leading-7 text-slate-500">Owner write access is required to prepare a follow-up or handoff.</p> : null}
        <button type="button" className={secondaryClass} disabled={saving || loading} onClick={startReview}>{pendingAttempt ? "Start a new source review" : "Refresh source review"}</button>
      </>}
    </div></BusinessDialog> : null}
  </>;
}
