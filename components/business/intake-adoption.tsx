"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BusinessDialog, buttonClass, inputClass, secondaryClass } from "./record-editor";

type ContactChoice = { id: string; name: string; email: string | null; phone: string | null; updatedAt: string };
type IntakeReview = {
  source: {
    id: string; connectionId: string; externalId: string; updatedAt: string;
    title: string; name: string | null; email: string | null; phone: string | null;
    description: string | null; account: string;
  };
  contacts: ContactChoice[];
  limited: boolean;
};
type AdoptionRequest = {
  action: "adopt_intake";
  key: string;
  connectionId: string;
  recordId: string;
  externalId: string;
  expectedUpdatedAt: string;
  contact: { mode: "create" } | { mode: "existing"; id: string; expectedUpdatedAt: string };
};
type AdoptionReceipt = {
  id: string; connectionId: string; sourceRecordId: string; sourceUpdatedAt: string;
  contactId: string; leadId: string; taskId: string; createdContact: boolean; replayed: boolean; message: string;
};

export function IntakeAdoption({ connectionId, recordId, adopted = false }: {
  connectionId: string; recordId: string; adopted?: boolean;
}) {
  const router = useRouter();
  const choiceName = useId();
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState<IntakeReview | null>(null);
  const [mode, setMode] = useState<"create" | "existing" | null>(null);
  const [contact, setContact] = useState<ContactChoice | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [receipt, setReceipt] = useState<AdoptionReceipt | null>(null);
  const [pendingAttempt, setPendingAttempt] = useState(false);
  const pending = useRef<AdoptionRequest | null>(null);
  const readLock = useRef(false), saveLock = useRef(false);
  const generation = useRef(0);
  const readController = useRef<AbortController | null>(null);
  useEffect(() => () => {
    generation.current++;
    readController.current?.abort();
  }, []);

  function resetIntent() {
    pending.current = null;
    setPendingAttempt(false);
    setError("");
    setNotice("");
  }
  async function load() {
    if (readLock.current || saveLock.current) return;
    readLock.current = true;
    const version = ++generation.current;
    const controller = new AbortController();
    readController.current = controller;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ connectionId, recordId });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/connections/intake?${params}`, { cache: "no-store", signal: controller.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The source and customer choices could not be loaded.");
      if (data.source?.id !== recordId || data.source?.connectionId !== connectionId ||
          typeof data.source.externalId !== "string" || typeof data.source.updatedAt !== "string" ||
          !Number.isFinite(Date.parse(data.source.updatedAt)) || !Array.isArray(data.contacts))
        throw new Error("The source review could not be confirmed. Refresh before choosing a customer.");
      if (controller.signal.aborted || version !== generation.current) return;
      if (review && (review.source.updatedAt !== data.source.updatedAt || review.source.externalId !== data.source.externalId)) {
        pending.current = null;
        setPendingAttempt(false);
        setMode(null);
        setContact(null);
        setNotice("The source changed. Review these current claims and choose the customer again.");
      }
      setReview(data as IntakeReview);
    } catch (cause) {
      if (!controller.signal.aborted && version === generation.current)
        setError(cause instanceof Error ? cause.message : "Source review is unavailable.");
    } finally {
      if (version === generation.current) {
        readLock.current = false;
        setLoading(false);
      }
    }
  }

  async function adopt() {
    if (saveLock.current || readLock.current || !review || !mode || (mode === "existing" && !contact)) return;
    if (!pending.current) pending.current = {
      action: "adopt_intake", key: crypto.randomUUID(), connectionId, recordId,
      externalId: review.source.externalId, expectedUpdatedAt: review.source.updatedAt,
      contact: mode === "create" ? { mode: "create" } : { mode: "existing", id: contact!.id, expectedUpdatedAt: contact!.updatedAt },
    };
    const request = pending.current;
    setPendingAttempt(true);
    saveLock.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/connections/intake", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The inquiry could not be added to shared work.");
      if (![result.id, result.contactId, result.leadId, result.taskId].every((id) => typeof id === "string" && !!id) ||
          result.connectionId !== connectionId || result.sourceRecordId !== recordId ||
          typeof result.sourceUpdatedAt !== "string" ||
          Date.parse(result.sourceUpdatedAt) !== Date.parse(request.expectedUpdatedAt) ||
          typeof result.createdContact !== "boolean" || typeof result.replayed !== "boolean" ||
          typeof result.message !== "string" || !result.message.trim())
        throw new Error("The server did not confirm a saved result. Retry the unchanged request to check its receipt.");
      setReceipt(result as AdoptionReceipt);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved result could not be confirmed.");
      setNotice("Retrying unchanged uses the same request key and customer choice. Choosing a different identity starts a new request.");
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  if (receipt) return <div className="mt-3 space-y-2 text-xs leading-6">
    <p role="status" className="text-slate-700">{receipt.replayed ? "Previously saved: " : ""}{receipt.message}</p>
    <div className="flex flex-wrap gap-4"><Link href="/client/todo" className="underline">Open To-do</Link><Link href={`/client/customer-work?leadId=${receipt.leadId}`} className="underline">Open customer work</Link></div>
  </div>;
  if (adopted && !pendingAttempt) return null;
  return <>
    <button type="button" className="mt-3 min-h-10 rounded-lg border px-3 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setOpen(true); if (!review) void load(); }}>
      {pendingAttempt ? "Check saved work" : "Add to shared work"}
    </button>
    {open ? <BusinessDialog title="Review form inquiry" onClose={() => setOpen(false)}>
      <div className="space-y-6">
        <p className="text-sm leading-7 text-slate-600">Choose the customer for this inquiry. The submitted name, email and phone are unverified claims and do not establish consent for outreach.</p>
        {error ? <p role="alert" className="rounded-lg border border-red-200 p-3 text-sm leading-6 text-red-800">{error}</p> : null}
        {notice ? <p role="status" className="text-xs leading-6 text-slate-600">{notice}</p> : null}
        {loading ? <p role="status" className="text-sm text-slate-500">Loading current source and customer records…</p> : null}
        {review ? <>
          <section className="rounded-xl border p-4" aria-label="Submitted source claims">
            <h3 className="font-medium">{review.source.title}</h3>
            <p className="mt-1 text-xs leading-6 text-slate-500">{review.source.account} · Source updated {review.source.updatedAt}</p>
            <dl className="mt-3 space-y-2 text-sm leading-6">
              {(["name", "email", "phone"] as const).map((field) => <div key={field}><dt className="text-xs capitalize text-slate-500">Submitted {field}</dt><dd className="break-words">{review.source[field] || "Not supplied"}</dd></div>)}
            </dl>
            {review.source.description ? <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">{review.source.description}</p> : null}
          </section>
          <fieldset disabled={saving || loading} className="space-y-4">
            <legend className="mb-3 text-sm font-medium">Choose an identity</legend>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm leading-6">
              <input type="radio" name={choiceName} checked={mode === "create"} onChange={() => { resetIntent(); setMode("create"); setContact(null); }} className="mt-1" />
              <span>Create a separate unverified customer<span className="mt-1 block text-xs text-slate-500">Use the submitted details for a new customer record. Review this choice carefully to avoid duplicates.</span></span>
            </label>
            <label className="flex items-start gap-3 rounded-xl border p-4 text-sm leading-6">
              <input type="radio" name={choiceName} checked={mode === "existing"} onChange={() => { resetIntent(); setMode("existing"); setContact(null); }} className="mt-1" />
              <span>Select an existing customer<span className="mt-1 block text-xs text-slate-500">Link the inquiry to the customer you choose. Existing customer details stay unchanged.</span></span>
            </label>
          </fieldset>
          {mode === "existing" ? <section className="space-y-3" aria-label="Existing customer selection">
            <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void load(); }}>
              <label className="min-w-40 flex-1 space-y-2 text-sm">Search customers<input className={inputClass} value={query} maxLength={100} disabled={saving || loading} onChange={(event) => setQuery(event.target.value)} placeholder="Name, email or phone" /></label>
              <button type="submit" className={secondaryClass} disabled={saving || loading}>Search</button>
            </form>
            {review.contacts.length ? <fieldset disabled={saving || loading} className="max-h-64 space-y-2 overflow-y-auto"><legend className="sr-only">Choose a customer record</legend>{review.contacts.map((item) => <label key={item.id} className="flex items-start gap-3 rounded-xl border p-3 text-sm leading-6"><input className="mt-1" type="radio" name={`${choiceName}-contact`} checked={contact?.id === item.id && contact.updatedAt === item.updatedAt} onChange={() => { resetIntent(); setContact(item); }} /><span className="min-w-0 break-words">{item.name || "Unnamed customer"}<span className="block text-xs text-slate-500">{[item.email, item.phone].filter(Boolean).join(" · ") || "No email or phone saved"}</span></span></label>)}</fieldset> : <p className="text-xs leading-6 text-slate-500">No customer records were returned for this search.</p>}
            {review.limited ? <p className="text-xs leading-6 text-slate-500">This is a bounded customer list. Refine the search if the customer is missing.</p> : null}
            {contact ? <p className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600">Selected: {contact.name || "Unnamed customer"}{contact.email ? ` · ${contact.email}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}. Saved version {contact.updatedAt}.</p> : null}
          </section> : null}
          <p className="text-xs leading-6 text-slate-500">Saving adds the inquiry and a follow-up task to shared work. Sending and agent activation require their own permissions and review.</p>
        </> : null}
        <div className="flex flex-wrap justify-between gap-3 border-t pt-4">
          <button type="button" className={secondaryClass} disabled={saving || loading} onClick={() => void load()}>Refresh source</button>
          <button type="button" className={buttonClass} disabled={saving || loading || !review || !mode || (mode === "existing" && !contact)} onClick={() => void adopt()}>{saving ? "Saving…" : "Save to shared work"}</button>
        </div>
      </div>
    </BusinessDialog> : null}
  </>;
}
