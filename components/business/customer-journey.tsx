"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type {
  CustomerJourney as JourneyRecord,
  CustomerJourneyAction,
  CustomerJourneyOffer,
  CustomerJourneySlot,
  CustomerJourneySnapshot,
} from "@/lib/business/customer-journey-contract";
import {
  buildJourneyCommand, customerJourneyHref, formatJourneyElapsed, invalidJourneyFilter, journeyActions, journeyActionNeedsSlot, journeyQuery,
  JOURNEY_STAGE_LABELS, JOURNEY_STATE_LABELS, journeyStateDetail, readJourneyReceipt,
  safeJourneyHref, visibleCustomerJourneys, type JourneyCommand, type JourneyFilter,
} from "@/lib/business/customer-journey-presentation";
import { validTimeZone } from "@/lib/business/daily-brief";
import { ownerButton, ownerInput, ownerQuietButton } from "./owner-ui";

type CommandAction = Extract<CustomerJourneyAction, { kind: "command" }>;
function JourneyLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  const safe = safeJourneyHref(href);
  if (!safe) return null;
  return safe.startsWith("/") ? <Link href={safe} className={className}>{children}</Link>
    : <a href={safe} className={className} target="_blank" rel="noopener noreferrer">{children} ↗</a>;
}
const when = (value: string | null, zone: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(zone), month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : null;
async function getJourneySnapshot(query: string, signal?: AbortSignal): Promise<CustomerJourneySnapshot> {
  const response = await fetch(`/api/business/customer-journey${query ? `?${query}` : ""}`, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Customer progress could not be loaded.");
  if (data.version !== 1 || !Array.isArray(data.journeys)) throw new Error("Customer progress could not be verified. Refresh to try again.");
  return data;
}

function JourneyCard({ journey, canWrite, compact, timeZone, onSaved, onPending }: {
  journey: JourneyRecord; canWrite: boolean; compact: boolean; timeZone: string;
  onSaved: () => Promise<void>; onPending: (id: string, pending: boolean) => void;
}) {
  const radioName = useId();
  const [selectedAction, setSelectedAction] = useState<CommandAction | null>(null);
  const [offer, setOffer] = useState<CustomerJourneyOffer | null>(null);
  const [slot, setSlot] = useState<CustomerJourneySlot | null>(null);
  const [service, setService] = useState("");
  const [preference, setPreference] = useState("");
  const [identityConfirmed, setIdentityConfirmed] = useState(false);
  const [bookingRequested, setBookingRequested] = useState(false);
  const [loadingOffer, setLoadingOffer] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAttempt, setPendingAttempt] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pending = useRef<JourneyCommand | null>(null);
  const lock = useRef(false);
  const offerGeneration = useRef(0);
  const actions = journeyActions(journey, canWrite);
  const shownStages = compact ? journey.stages.filter((stage) => stage.status !== "unknown") : journey.stages;
  const observations = (journey.observations ?? []).flatMap((observation) => {
    const elapsed = formatJourneyElapsed(observation.seconds);
    return elapsed ? [{ ...observation, elapsed }] : [];
  });
  useEffect(() => () => {
    offerGeneration.current++;
    onPending(journey.id, false);
  }, [journey.id, onPending]);
  function resetIntent() {
    pending.current = null;
    setPendingAttempt(false);
    onPending(journey.id, false);
    setError("");
    setNotice("");
  }
  async function getOffer() {
    if (lock.current) return;
    const version = ++offerGeneration.current;
    setLoadingOffer(true);
    setError("");
    setOffer(null);
    setSlot(null);
    try {
      const response = await fetch(`/api/business/customer-journey/availability?leadId=${encodeURIComponent(journey.leadId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The scheduling offer is not available yet. Refresh progress to check the assigned work.");
      if (!data.id || !Array.isArray(data.slots) || !Number.isFinite(Date.parse(data.expiresAt)))
        throw new Error("A saved availability offer could not be confirmed.");
      if (version === offerGeneration.current) setOffer(data as CustomerJourneyOffer);
    } catch (cause) {
      if (version === offerGeneration.current) setError(cause instanceof Error ? cause.message : "The availability offer could not be loaded.");
    } finally {
      if (version === offerGeneration.current) setLoadingOffer(false);
    }
  }
  async function sendRequest(request: JourneyCommand) {
    if (lock.current || !canWrite) return;
    lock.current = true;
    pending.current = request;
    setPendingAttempt(true);
    onPending(journey.id, true);
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/business/customer-journey", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The change could not be saved.");
      const result = readJourneyReceipt(data.result);
      setNotice(`${result.replayed ? "Previously saved: " : ""}${result.message}`);
      pending.current = null;
      setPendingAttempt(false);
      onPending(journey.id, false);
      setSelectedAction(null);
      setOffer(null);
      setSlot(null);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The saved result could not be confirmed.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  function submit(action: CommandAction) {
    try {
      const request = buildJourneyCommand(action, crypto.randomUUID(), {
        qualification: { service, preference, identityConfirmed, bookingRequested }, offer, slot,
      });
      void sendRequest(request);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review the action details.");
    }
  }
  function chooseAction(action: CommandAction) {
    if (lock.current) return;
    resetIntent();
    if (action.requiresQualification || action.command === "progress_inquiry" || journeyActionNeedsSlot(action)) {
      setSelectedAction(action);
      setOffer(null);
      setSlot(null);
      setIdentityConfirmed(false);
      setBookingRequested(false);
      if (journeyActionNeedsSlot(action)) void getOffer();
    } else submit(action);
  }
  const identity = journey.customer.identity === "owner_verified" ? "Owner-reviewed identity" : "Identity not verified";
  return <article className="rounded-xl border border-slate-200 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h3 className="break-words text-sm font-medium">{journey.title}</h3><p className="mt-1 text-xs leading-6 text-slate-500">{journey.customer.name} · {identity}</p></div>
      {compact ? <Link href={customerJourneyHref({ leadId: journey.leadId })} className="text-xs text-slate-500 underline">Open customer work</Link> : null}
    </div>
    {journey.warnings.length ? <p className="mt-3 text-xs leading-6 text-amber-800">{journey.warnings.join(" ")}</p> : null}
    <ol className="mt-4 space-y-4 border-l border-slate-200 pl-4" aria-label="Customer journey stages">
      {shownStages.map((stage, index) => <li key={`${stage.key}:${index}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"><h4 className="text-xs font-medium">{JOURNEY_STAGE_LABELS[stage.key]}</h4><span className={`text-[11px] ${["review", "needs_owner", "provider_pending"].includes(stage.status) ? "text-amber-800" : "text-slate-500"}`}>{JOURNEY_STATE_LABELS[stage.status] || "Not verified"}</span></div>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-6 text-slate-600">{stage.summary}</p>
        {journeyStateDetail(stage.status) ? <p className="text-[11px] leading-6 text-slate-500">{journeyStateDetail(stage.status)}</p> : null}
        {when(stage.updatedAt, timeZone) ? <p className="text-[11px] text-slate-400">Updated {when(stage.updatedAt, timeZone)}</p> : null}
        {stage.href ? <JourneyLink href={stage.href} className="mt-1 inline-block text-xs text-slate-500 underline">Review this stage</JourneyLink> : null}
        {!compact && stage.sources.length ? <details className="mt-1 text-[11px] leading-6 text-slate-500"><summary className="cursor-pointer">Source evidence · {stage.sources.length}</summary>{stage.sources.map((source) => <p className="break-all" key={`${source.kind}:${source.id}`}>{source.href ? <JourneyLink href={source.href}>Open source record</JourneyLink> : "Source record"} · {source.id}{source.revision ? ` · version ${source.revision}` : ""}</p>)}</details> : null}
      </li>)}
    </ol>
    {observations.length ? <section className="mt-4 border-t border-slate-100 pt-4" aria-label="Recorded timing">
      <h4 className="text-xs font-medium text-slate-600">Recorded timing</h4>
      <dl className="mt-2 space-y-3">{observations.map((observation) => <div key={observation.key}>
        <dt className="text-xs text-slate-600">{observation.label}</dt>
        <dd className="mt-1 text-xs leading-6"><span className="font-medium">{observation.elapsed}</span>
          {!compact ? <p className="text-[11px] text-slate-500">{observation.detail}</p> : null}
          {!compact && observation.sources.length ? <details className="text-[11px] text-slate-500"><summary className="cursor-pointer">Timestamp sources · {observation.sources.length}</summary>{observation.sources.map((source) => <p className="break-all" key={`${source.kind}:${source.id}`}>{source.href ? <JourneyLink href={source.href}>Open source record</JourneyLink> : "Source record"} · {source.id}{source.revision ? ` · version ${source.revision}` : ""}</p>)}</details> : null}
        </dd>
      </div>)}</dl>
      {compact ? <p className="mt-2 text-[11px] leading-6 text-slate-500">Elapsed time in the loaded records, including any waiting.</p> : null}
    </section> : null}
    {notice ? <p role="status" className="mt-4 text-xs leading-6 text-slate-700">{notice}</p> : null}
    {error ? <p role="alert" className="mt-4 text-xs leading-6 text-red-800">{error}</p> : null}
    {pendingAttempt ? <div className="mt-4 space-y-2"><p className="text-xs leading-6 text-slate-500">This request has no confirmed receipt yet. Retry keeps the same key and exact reviewed details.</p><div className="flex flex-wrap gap-3"><button type="button" className={ownerButton} disabled={saving || !canWrite} onClick={() => { if (pending.current) void sendRequest(pending.current); }}>{saving ? "Checking…" : "Check saved request"}</button><button type="button" className={ownerQuietButton} disabled={saving} onClick={() => { resetIntent(); setSelectedAction(null); setOffer(null); setSlot(null); }}>Start a new review</button></div></div> : null}
    {!pendingAttempt && actions.length ? <div className="mt-4 flex flex-wrap gap-3" aria-label="Available customer work decisions">{actions.map((action, index) => action.kind === "link" ? <JourneyLink key={`link:${action.href}`} href={action.href} className={ownerQuietButton}>{action.label}</JourneyLink> : <button key={`${action.command}:${index}`} type="button" className={index === 0 ? ownerButton : ownerQuietButton} disabled={saving || loadingOffer} onClick={() => chooseAction(action)}>{action.command === "request_cancellation" ? "Request cancellation review" : action.label}</button>)}</div> : null}
    {selectedAction && !pendingAttempt ? <form className="mt-5 space-y-4 rounded-xl bg-slate-50 p-4" onSubmit={(event) => { event.preventDefault(); submit(selectedAction); }}>
      <h4 className="text-sm font-medium">{selectedAction.label}</h4>
      {selectedAction.requiresQualification || selectedAction.command === "progress_inquiry" ? <>
        <p className="text-xs leading-6 text-slate-600">Review the selected customer: {journey.customer.name}{journey.customer.email ? ` · ${journey.customer.email}` : ""}{journey.customer.phone ? ` · ${journey.customer.phone}` : ""}. Source claims alone do not verify identity or consent.</p>
        <label className="block space-y-2 text-xs">Requested service<input required maxLength={200} className={ownerInput} value={service} onChange={(event) => { resetIntent(); setService(event.target.value); }} /></label>
        <label className="block space-y-2 text-xs">Customer’s timing preference (optional)<textarea rows={2} maxLength={500} className={ownerInput} value={preference} onChange={(event) => { resetIntent(); setPreference(event.target.value); }} /></label>
        <label className="flex items-start gap-3 text-xs leading-6"><input type="checkbox" checked={identityConfirmed} onChange={(event) => { resetIntent(); setIdentityConfirmed(event.target.checked); }} className="mt-1" />I checked the customer identity and contact details.</label>
        <label className="flex items-start gap-3 text-xs leading-6"><input type="checkbox" checked={bookingRequested} onChange={(event) => { resetIntent(); setBookingRequested(event.target.checked); }} className="mt-1" />The customer requested booking help for this service.</label>
        <p className="text-xs leading-6 text-slate-500">This saves scheduling work for the specialist. Available times and any booking decision come next.</p>
      </> : null}
      {journeyActionNeedsSlot(selectedAction) ? <>
        {loadingOffer ? <p role="status" className="text-xs">Loading the saved availability offer…</p> : null}
        {offer ? <><p className="text-xs leading-6 text-slate-600">{offer.detail} Offer expires {when(offer.expiresAt, offer.timezone) || "at its recorded expiry"}.</p><fieldset className="space-y-2"><legend className="mb-2 text-xs font-medium">Choose an offered time · {offer.timezone}</legend>{offer.slots.map((item, index) => <label key={`${item.start_iso}:${index}`} className="flex items-start gap-3 rounded-lg border bg-white p-3 text-xs leading-6"><input className="mt-1" type="radio" name={radioName} checked={slot?.start_iso === item.start_iso && slot?.end_iso === item.end_iso && slot?.label === item.label} onChange={() => { resetIntent(); setSlot(item); }} />{item.label}</label>)}</fieldset>{!offer.slots.length ? <p className="text-xs text-slate-500">No offered times are available in this saved result.</p> : null}</> : null}
        <p className="text-xs leading-6 text-slate-500">An offer is not a reservation. Saving this choice prepares the next supported booking step; confirmation requires the authoritative result.</p>
        <button type="button" className={ownerQuietButton} disabled={loadingOffer || saving} onClick={() => { resetIntent(); void getOffer(); }}>Reload saved offer</button>
      </> : null}
      <button type="submit" className={ownerButton} disabled={saving || loadingOffer || !canWrite ||
        ((selectedAction.requiresQualification || selectedAction.command === "progress_inquiry") && (!service.trim() || !identityConfirmed || !bookingRequested)) ||
        (journeyActionNeedsSlot(selectedAction) && (!offer || !slot))}>{saving ? "Saving…" : "Save reviewed request"}</button>
    </form> : null}
    {actions.some((action) => action.kind === "command" && action.command === "request_cancellation") ? <p className="mt-3 text-[11px] leading-6 text-slate-500">A cancellation request saves review work. It does not establish that an external calendar appointment has been cancelled.</p> : null}
  </article>;
}

export function CustomerJourneyDisclosure({ filter, timeZone }: { filter: JourneyFilter; timeZone: string }) {
  const [open, setOpen] = useState(false);
  return <details className="mt-5 rounded-xl border border-slate-200 p-4" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer text-xs font-medium text-slate-600">Customer progress & next decision</summary>
    {open ? <CustomerJourneyWorkspace filter={filter} timeZone={timeZone} compact /> : null}
  </details>;
}

export function CustomerJourneyWorkspace({ filter = {}, timeZone = "UTC", compact = false }: {
  filter?: JourneyFilter; timeZone?: string; compact?: boolean;
}) {
  const query = journeyQuery(filter);
  const invalid = invalidJourneyFilter(filter);
  const [loaded, setLoaded] = useState<{ query: string; snapshot: CustomerJourneySnapshot } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const pending = useRef(new Set<string>());
  const invalidateReads = useCallback(() => {
    generation.current++;
    inFlight.current = false;
  }, []);
  const snapshot = loaded?.query === query ? loaded.snapshot : null;
  const onPending = useCallback((id: string, active: boolean) => {
    if (active) pending.current.add(id); else pending.current.delete(id);
  }, []);
  const refresh = useCallback(async () => {
    if (invalid || inFlight.current) return;
    const version = ++generation.current;
    inFlight.current = true;
    setLoading(true);
    try {
      const data = await getJourneySnapshot(query);
      if (version === generation.current) { setLoaded({ query, snapshot: data }); setError(""); }
    } catch (cause) {
      if (version === generation.current) setError(cause instanceof Error ? cause.message : "Customer progress is unavailable.");
    } finally {
      if (version === generation.current) { inFlight.current = false; setLoading(false); }
    }
  }, [query, invalid]);
  useEffect(() => {
    if (invalid) return;
    const controller = new AbortController();
    const version = ++generation.current;
    inFlight.current = false;
    pending.current.clear();
    void getJourneySnapshot(query, controller.signal).then((data) => {
      if (!controller.signal.aborted && version === generation.current) { setLoaded({ query, snapshot: data }); setError(""); }
    }).catch((cause) => {
      if (!controller.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : "Customer progress is unavailable.");
    });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && pending.current.size === 0) void refresh();
    }, 15000);
    return () => { controller.abort(); clearInterval(timer); invalidateReads(); };
  }, [query, invalid, refresh, invalidateReads]);
  const journeys = snapshot ? visibleCustomerJourneys(snapshot, filter) : [];
  return <section className={compact ? "mt-5 space-y-4" : "space-y-5"} aria-label="Customer work progress">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className={compact ? "text-sm font-medium" : "text-lg font-medium"}>Customer progress</h2><button type="button" className={ownerQuietButton} disabled={loading || invalid} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh progress"}</button></div>
    {invalid ? <p role="alert" className="text-sm text-red-800">Choose a valid customer work link from Messages or To-do.</p> : null}
    {error ? <p role="alert" className="text-xs leading-6 text-amber-800">{error} Existing messages and decisions keep their own checks.</p> : null}
    {!snapshot && !invalid && !error ? <p role="status" className="text-xs text-slate-500">Loading linked customer records…</p> : null}
    {snapshot?.errors.length ? <p className="text-xs leading-6 text-amber-800">{snapshot.errors.join(" ")}</p> : null}
    {journeys.map((journey) => <JourneyCard key={journey.id} journey={journey} canWrite={!!snapshot?.canWrite} compact={compact} timeZone={timeZone} onSaved={refresh} onPending={onPending} />)}
    {snapshot && !journeys.length ? <p className="text-xs leading-6 text-slate-500">No linked customer journey is available in this loaded view. New or unlinked inquiries remain in Messages.</p> : null}
    {snapshot?.limited ? <p className="text-xs leading-6 text-slate-500">This view contains a bounded set of linked customer records. Other work may exist.</p> : null}
    {snapshot ? <p className="text-[11px] leading-6 text-slate-400">Loaded {when(snapshot.generatedAt, timeZone) || "at the recorded source time"}. Drafts, approvals and queued work are separate from verified booking or delivery results.</p> : null}
  </section>;
}
