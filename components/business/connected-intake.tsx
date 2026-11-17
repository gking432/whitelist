"use client";

import { useState } from "react";
import Link from "next/link";
import type { ConnectedData } from "@/lib/connections/types";
import { connectedStreamWarnings, safeSourceUrl, validTimeZone } from "@/lib/business/daily-brief";
import { IntakeAdoption } from "./intake-adoption";
import { customerJourneyHref } from "@/lib/business/customer-journey-presentation";

export function ConnectedIntakeRecords({ data, timeZone, compact = false, canAdopt = false }: { data: ConnectedData; timeZone: string; compact?: boolean; canAdopt?: boolean }) {
  const leads = data.leads ?? [];
  if (!leads.length) return null;
  const warnings = connectedStreamWarnings(data, ["lead"]);
  const limit = compact ? 3 : 100;
  return <section id="form-inquiries" className="mb-9" aria-labelledby={compact ? "mobile-form-title" : "form-inquiries-title"}>
    <h2 id={compact ? "mobile-form-title" : "form-inquiries-title"} className="text-sm font-medium">Form inquiries</h2>
    <p className="mt-2 text-xs leading-6 text-slate-500">Saved submissions from your website intake. A saved inquiry does not establish consent for outreach.</p>
    {warnings.length ? <p className="mt-3 text-xs leading-6 text-amber-800">{warnings.join(" ")}</p> : null}
    <div className="mt-3 divide-y divide-slate-100">{leads.slice(0, limit).map((lead) => <article key={`${lead.connectionId}:${lead.id}`} className="py-4"><p className="break-words text-sm">{lead.title}</p>{lead.preview ? <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-slate-600">{lead.preview}</p> : null}<p className="mt-1 text-xs leading-6 text-slate-500">{lead.account} · {lead.status.replaceAll("_", " ")}{lead.receivedAt && Number.isFinite(Date.parse(lead.receivedAt)) ? ` · ${new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(timeZone), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(lead.receivedAt))}` : ""}</p>{safeSourceUrl(lead.href) ? <a className="mt-1 inline-block text-xs text-slate-500 underline" href={safeSourceUrl(lead.href)!} target="_blank" rel="noopener noreferrer">Source form ↗</a> : null}{lead.nativeId ? <Link href={customerJourneyHref({ leadId: lead.nativeId })} className="ml-4 text-xs text-slate-500 underline">Customer progress</Link> : null}{!compact && canAdopt ? <IntakeAdoption connectionId={lead.connectionId} recordId={lead.id} adopted={!!lead.nativeId} /> : null}</article>)}</div>
    {compact || leads.length > limit || data.limited ? <p className="mt-3 text-xs leading-6 text-slate-500">{compact ? <Link href="/client/messages#form-inquiries" className="underline">Open form inquiries</Link> : "This is a bounded set of imported submissions."}</p> : null}
  </section>;
}

export type IntakeSetupReceipt = {
  connectionId: string;
  url: string;
  token: string;
  header: string;
  detail: string;
};

/** A preparation receipt is held only in this page's memory, never local storage. */
export function ConnectedIntake({ receipt }: { receipt: IntakeSetupReceipt }) {
  const [copied, setCopied] = useState("");
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copied.`);
    } catch {
      setCopied(`Copy was unavailable. Select the ${label.toLowerCase()} below and copy it.`);
    }
  }
  return (
    <section aria-labelledby="intake-setup-title" className="mt-6 rounded-xl border border-blue-100 bg-blue-50/40 p-5">
      <h2 id="intake-setup-title" className="text-sm font-medium">Website form intake prepared</h2>
      <p className="mt-2 text-xs leading-6 text-slate-600">{receipt.detail}</p>
      <p className="mt-2 text-xs leading-6 text-slate-600">Copy the endpoint and secret token now. The token is shown for this preparation response; the account list does not reveal it later. Add it to your form server or trusted form automation. An actual submission is still needed to verify intake.</p>
      <dl className="mt-4 space-y-4">
        <div><dt className="text-xs font-medium">Endpoint</dt><dd className="mt-1 break-all rounded-lg bg-white p-3 text-xs select-all">{receipt.url}</dd><dd><button type="button" className="mt-2 text-xs underline" onClick={() => void copy(receipt.url, "Endpoint")}>Copy endpoint</button></dd></div>
        <div><dt className="text-xs font-medium">Secret token · send as {receipt.header}</dt><dd className="mt-1 break-all rounded-lg bg-white p-3 font-mono text-xs select-all">{receipt.token}</dd><dd><button type="button" className="mt-2 text-xs underline" onClick={() => void copy(receipt.token, "Token")}>Copy token</button></dd></div>
      </dl>
      <details className="mt-5 text-xs leading-6 text-slate-600"><summary className="cursor-pointer font-medium">Form submission format</summary><p className="mt-2">POST JSON with event_type set to form.submitted, a stable idempotency_key for each submission and data containing a stable source id. Optional data fields: name, email, phone, message, submitted_at (ISO timestamp) and source_url (HTTPS). Reuse the same submission IDs when retrying.</p><p className="mt-2">For edits or deletion, use lead.updated or lead.deleted with the same data.id, required updated_at ISO timestamp and a new idempotency_key for each source change. Reuse that event key only when retrying.</p><p className="mt-2">Keep the token in the server or trusted automation. A public browser form should submit to your server, which forwards the request with the token.</p></details>
      {copied ? <p role="status" className="mt-3 text-xs text-slate-700">{copied}</p> : null}
    </section>
  );
}
