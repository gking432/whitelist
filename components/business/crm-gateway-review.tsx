"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CrmGatewayCommand, CrmGatewayDecisionReceipt, CrmGatewayPin, CrmGatewayReview } from "@/lib/crm/provider-contract";
import { buildCrmGatewayCommand, CRM_PROPERTY_LIMITS, crmReviewBlock, crmSourceTime, hubspotSourceHref, readCrmGatewayReceipt, readCrmGatewayReview } from "@/lib/crm/gateway-presentation";
import { BusinessDialog, buttonClass, inputClass, secondaryClass } from "./record-editor";

const propertyLabels = { firstname: "First name", lastname: "Last name", email: "Email", phone: "Phone", address: "Address" };

export function CrmGatewayReviewWidget({ connectionId, recordId, timeZone, sourceRunId }: {
  connectionId: string; recordId?: string; timeZone: string; sourceRunId?: string;
}) {
  const router = useRouter();
  const operation = recordId ? "note.create" : "contact.create";
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<CrmGatewayReview | null>(null);
  const [reviewedSourceRunId, setReviewedSourceRunId] = useState(sourceRunId);
  const [note, setNote] = useState("");
  const [properties, setProperties] = useState<CrmGatewayPin["properties"]>({});
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [newIdentityConfirmed, setNewIdentityConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState(false);
  const [pendingSourceRunId, setPendingSourceRunId] = useState<string | undefined>();
  const [receipt, setReceipt] = useState<CrmGatewayDecisionReceipt | null>(null);
  const [error, setError] = useState("");
  const pending = useRef<CrmGatewayCommand | null>(null);
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
      const params = new URLSearchParams({ connectionId });
      if (recordId) params.set("recordId", recordId);
      if (sourceRunId) params.set("sourceRunId", sourceRunId);
      const response = await fetch(`/api/business/crm-gateway?${params}`, { cache: "no-store", signal: requestController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The exact HubSpot source could not be reviewed.");
      const current = readCrmGatewayReview(data, { connectionId, recordId, sourceRunId });
      if (!requestController.signal.aborted && version === generation.current) { setReview(current); setReviewedSourceRunId(sourceRunId); }
    } catch (cause) {
      if (!requestController.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : "The HubSpot review is unavailable.");
    } finally {
      if (version === generation.current) { readLock.current = false; setLoading(false); }
    }
  }
  function startReview() {
    if (readLock.current || saveLock.current) return;
    pending.current = null;
    setPendingAttempt(false);
    setPendingSourceRunId(undefined);
    setReview(null);
    setNote("");
    setProperties({});
    setTargetConfirmed(false);
    setNewIdentityConfirmed(false);
    void load();
  }
  async function save(request: CrmGatewayCommand) {
    if (readLock.current || saveLock.current) return;
    saveLock.current = true;
    pending.current = request;
    setPendingAttempt(true);
    setPendingSourceRunId(request.sourceRunId);
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/business/crm-gateway", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The HubSpot proposal could not be confirmed as saved.");
      const saved = readCrmGatewayReceipt(data.result, request.connectionId);
      setReceipt(saved);
      pending.current = null;
      setPendingAttempt(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved proposal could not be confirmed. Check this same request again.");
    } finally { saveLock.current = false; setSaving(false); }
  }
  function submit() {
    if (!review || readLock.current || saveLock.current || pending.current) return;
    if (reviewedSourceRunId !== sourceRunId) { setError("The saved-work reference changed. Refresh this review and confirm the proposal again."); return; }
    try { void save(buildCrmGatewayCommand(review, operation, crypto.randomUUID(), { targetConfirmed, newIdentityConfirmed, note, properties, sourceRunId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Review the exact HubSpot target and proposed change."); }
  }
  const block = reviewedSourceRunId !== sourceRunId ? "The saved-work reference changed. Refresh the source review before preparing a new proposal." : review ? crmReviewBlock(review, operation) : null;
  const contact = review?.contact;
  const sourceHref = contact ? hubspotSourceHref(contact.href, contact.accountId) : null;
  return <>
    <button type="button" className="mt-3 min-h-10 rounded-lg border px-3 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setOpen(true); if (!review && !pending.current && !receipt) void load(); }}>
      {receipt ? "View saved HubSpot proposal" : pendingAttempt ? "Check saved proposal" : recordId ? "Review a note for this contact" : "Propose a new HubSpot customer"}
    </button>
    {open ? <BusinessDialog title={recordId ? "Review HubSpot contact note" : "Review new HubSpot customer"} onClose={() => setOpen(false)}>
      <div className="space-y-6">
        <p className="text-sm leading-7 text-slate-600">This prepares one proposal for the existing approval inbox. Imported names and addresses do not establish customer identity or outreach permission. No message is sent and no other customer is merged.</p>
        {error ? <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm leading-6 text-red-800">{error}</p> : null}
        {receipt ? <section className="space-y-3" aria-label="Saved HubSpot proposal"><p role="status" className="text-sm leading-7">{receipt.replayed ? "Previously saved: " : ""}{receipt.message}</p><Link href="/client/approvals" className="text-sm underline">Review saved approval</Link><p className="text-xs leading-6 text-slate-500">A saved or approved proposal is separate from a verified HubSpot result.</p></section> : <>
          {loading ? <p role="status" className="text-sm text-slate-500">Checking the exact HubSpot account and source…</p> : null}
          {review?.sourceRun ? <section className="space-y-3 rounded-xl border p-4" aria-label="Original saved work"><h3 className="text-sm font-medium">Original saved work</h3><p className="text-xs leading-6 text-slate-500">{review.sourceRun.templateKey || "Work type unavailable"} · {review.sourceRun.eventType || "Source event unavailable"} · {crmSourceTime(review.sourceRun.createdAt, timeZone) || "Time unavailable"}</p><p className="whitespace-pre-wrap break-words text-sm leading-7">{review.sourceRun.summary || "No summary was saved for this work. Review the original customer request before continuing."}</p><p className="text-xs leading-6 text-slate-500">Treat this saved summary as source context to review. It does not verify a customer, choose fields or authorize outreach. Confirm the target and every proposed change yourself.</p></section> : null}
          {review ? <section className="space-y-3 rounded-xl border p-4" aria-label="HubSpot target review">
            <h3 className="break-words text-sm font-medium">{review.account}</h3>
            <p className="break-all text-xs leading-6 text-slate-500">HubSpot account {review.accountId} · {review.selectedCrm ? "Selected CRM" : "CRM not selected"} · {review.actionsEnabled ? "Approved actions enabled" : "Approved actions off"}</p>
            <p className="text-xs leading-6 text-slate-500">Verified action grants: {review.permissions.length ? review.permissions.map((permission) => permission === "note.create" ? "contact notes" : "new customers").join(" · ") : "none"}. An owner approval and final source checks are still required.</p>
            {contact ? <>
              <h4 className="break-words text-sm font-medium">{contact.name}</h4>
              <dl className="space-y-2 text-xs leading-6"><div><dt className="text-slate-500">Imported email / phone</dt><dd className="break-words">{contact.email || "Email not supplied"} · {contact.phone || "Phone not supplied"}</dd></div><div><dt className="text-slate-500">Exact source contact</dt><dd className="break-all">{contact.externalId}{contact.archived ? " · Archived" : ""}</dd></div><div><dt className="text-slate-500">Source updated / observed</dt><dd>{crmSourceTime(contact.sourceUpdatedAt, timeZone) || "Update time unavailable"} / {crmSourceTime(contact.observedAt, timeZone) || "Observation time unavailable"}</dd></div></dl>
              {sourceHref ? <a href={sourceHref} target="_blank" rel="noopener noreferrer" className="inline-block text-xs underline">Open exact HubSpot contact ↗</a> : null}
              <p className="text-xs leading-6 text-slate-500">Customer property corrections are made in HubSpot. This proposal only adds the reviewed note to the exact contact above.</p>
            </> : <p className="text-xs leading-6 text-slate-500">Open this HubSpot account and check for an existing customer before proposing a deliberately new record. No contact has been selected or inferred from an imported address.</p>}
          </section> : null}
          {block ? <p className="text-sm leading-7 text-amber-800">{block}</p> : null}
          {review?.existing ? <section className="space-y-2 text-xs leading-6" aria-label="Existing HubSpot proposal"><p className="font-medium">Existing proposal · {review.existing.status.replaceAll("_", " ")}</p><p>{review.existing.detail}</p><Link href="/client/approvals" className="underline">Open existing approval</Link></section> : null}
          {pendingAttempt ? <section className="space-y-3" aria-label="Unconfirmed HubSpot proposal"><p className="text-sm leading-7">No saved receipt is confirmed. Checking again retains the exact reviewed payload and key, including the original target.</p>{pendingSourceRunId ? <p className="break-all text-xs leading-6 text-slate-500">Pending request references saved work {pendingSourceRunId}.</p> : null}<button type="button" className={buttonClass} disabled={saving} onClick={() => { if (pending.current) void save(pending.current); }}>{saving ? "Checking…" : "Check saved request"}</button></section> : review ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <fieldset className="space-y-4" disabled={saving || loading || !!block}>
              <legend className="mb-3 text-sm font-medium">{recordId ? "Exact note to propose" : "New customer fields to propose"}</legend>
              {recordId ? <label className="block space-y-2 text-sm">Note<textarea className={inputClass} value={note} maxLength={4000} rows={5} required onChange={(event) => { setNote(event.target.value); setTargetConfirmed(false); }} /></label> : (Object.keys(CRM_PROPERTY_LIMITS) as (keyof typeof CRM_PROPERTY_LIMITS)[]).map((field) => <label key={field} className="block space-y-2 text-sm">{propertyLabels[field]}<input className={inputClass} type={field === "email" ? "email" : field === "phone" ? "tel" : "text"} value={properties[field] || ""} maxLength={CRM_PROPERTY_LIMITS[field]} onChange={(event) => { setProperties((current) => ({ ...current, [field]: event.target.value })); setTargetConfirmed(false); setNewIdentityConfirmed(false); }} /></label>)}
              <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={targetConfirmed} onChange={(event) => setTargetConfirmed(event.target.checked)} />{recordId ? "I reviewed this exact HubSpot account, contact and note." : "I reviewed this exact HubSpot account and every proposed field."}</label>
              {!recordId ? <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" className="mt-1" checked={newIdentityConfirmed} onChange={(event) => setNewIdentityConfirmed(event.target.checked)} />I checked HubSpot for duplicates and deliberately want a separate new customer. This does not update or merge existing contacts.</label> : null}
            </fieldset>
            <p className="text-xs leading-6 text-slate-500">Approval authorizes only this exact change. Current permissions, pauses and source state are checked again before execution. Check the saved provider result before trying another change.</p>
            <button type="submit" className={buttonClass} disabled={saving || loading || !!block || !targetConfirmed || (!recordId && !newIdentityConfirmed)}>Prepare for approval</button>
          </form> : null}
          <button type="button" className={secondaryClass} disabled={saving || loading} onClick={startReview}>{pendingAttempt ? "Start a new source review" : "Refresh source review"}</button>
        </>}
      </div>
    </BusinessDialog> : null}
  </>;
}
