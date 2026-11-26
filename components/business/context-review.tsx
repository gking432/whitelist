"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AUTHORITY_CHANNELS,
  AUTHORITY_MODES,
  type AuthorityChannel,
  type AuthorityMode,
  type BusinessContextCommand,
  type BusinessContextSnapshot,
} from "@/lib/business/context-contract";
import { fetchBusinessContext, sendBusinessContextCommand } from "./context-client";
import { OnboardingProgress } from "./onboarding-progress";
import { ownerButton, ownerInput, ownerQuietButton, OwnerAreaHeader } from "./owner-ui";

const modeLabels: Record<AuthorityMode, string> = {
  off: "Off",
  observe: "Observe only",
  draft: "Prepare drafts",
  require_approval: "Act after approval",
};
const factLabels: Record<string, string> = {
  description: "Business description", industry: "Business type", goals: "Goals",
  services: "Services & prices", audience: "Customers", tone: "Voice",
  hours: "Hours", policies: "Policies", currency: "Currency", website: "Website",
};
const sourceLabels: Record<string, string> = {
  business_workspace_profiles: "Business details",
  business_records: "Business record",
  crm_leads: "Lead",
  agent_work_items: "Assignment",
  approval_items: "Owner decision",
  business_conversations: "Conversation",
  integration_records: "Connected app record",
};

export function BusinessContextReview() {
  const [snapshot, setSnapshot] = useState<BusinessContextSnapshot | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<AuthorityChannel, AuthorityMode>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const lock = useRef(false);
  const generation = useRef(0);
  const pending = useRef<{ signature: string; command: BusinessContextCommand } | null>(null);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (lock.current) return;
    const version = ++generation.current;
    try {
      const data = await fetchBusinessContext(fetch, signal);
      if (!signal?.aborted && version === generation.current) {
        setSnapshot(data);
        setError("");
      }
    } catch (cause) {
      if (!signal?.aborted && version === generation.current)
        setError(cause instanceof Error ? cause.message : "Business context is unavailable.");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const version = ++generation.current;
    void fetchBusinessContext(fetch, controller.signal).then((data) => {
      if (!controller.signal.aborted && version === generation.current) setSnapshot(data);
    }).catch((cause) => {
      if (!controller.signal.aborted && version === generation.current) setError(cause instanceof Error ? cause.message : "Business context is unavailable.");
    });
    return () => controller.abort();
  }, []);

  async function save(command: BusinessContextCommand) {
    if (lock.current || !snapshot?.canWrite) return;
    const { key: _key, ...intent } = command;
    const signature = JSON.stringify(intent);
    if (pending.current?.signature !== signature) pending.current = { signature, command };
    lock.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const data = await sendBusinessContextCommand(pending.current.command);
      setSnapshot(data.snapshot);
      if (command.action === "set_authority") setDrafts((current) => {
        const next = { ...current };
        delete next[command.channel];
        return next;
      });
      setNotice(data.result.replayed ? `Previously saved: ${data.result.message} Current permissions are shown below.` : data.result.message);
      pending.current = null;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your change could not be saved.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const known = snapshot?.facts.filter((fact) => fact.state === "known") ?? [];
  const reviewed = known.length > 0 && known.every((fact) => fact.reviewed);
  return (
    <div className="mx-auto max-w-4xl space-y-8 p-5 sm:p-8">
      <OwnerAreaHeader title="Review your business">
        <button type="button" className={ownerQuietButton} disabled={busy} onClick={() => void refresh()}>Refresh</button>
      </OwnerAreaHeader>
      <OnboardingProgress current="context" />
      <p className="max-w-2xl text-sm leading-7 text-slate-600">Review the facts your manager uses, then choose the work it may do. Connecting an account does not grant permission to act.</p>
      {error ? <p role="alert" className="rounded-lg border border-red-200 p-4 text-sm text-red-800">{error} Your unsaved choices are kept here. Refresh to check the current version before retrying.</p> : null}
      {notice ? <p role="status" className="rounded-lg border p-4 text-sm">{notice}</p> : null}
      {!snapshot && !error ? <p role="status" className="text-sm text-slate-500">Loading your business facts…</p> : null}
      {snapshot ? <>
        {!snapshot.canWrite ? <p className="text-sm text-slate-600">You have read-only access.</p> : null}
        <section className="space-y-5 rounded-xl border p-5">
          <div className="flex flex-wrap justify-between gap-3"><h2 className="font-medium">Business facts</h2><Link href="/client/business/business" className="text-xs underline">Edit details</Link></div>
          <dl className="grid gap-5 sm:grid-cols-2">
            {snapshot.facts.map((fact) => <div key={fact.key} className="min-w-0">
              <dt className="text-xs text-slate-500">{factLabels[fact.key] ?? fact.key}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{fact.state === "unknown" ? "Not yet known" : Array.isArray(fact.value) ? fact.value.join(", ") : fact.value}</dd>
              <dd className="mt-1 text-[11px] text-slate-500">{fact.state === "conflict" ? "Conflicting facts · review needed" : fact.reviewed ? "Reviewed" : fact.state === "unknown" ? "Add this when available" : "Awaiting your review"}</dd>
              {fact.sources.length ? <dd className="mt-1 text-[11px] leading-5 text-slate-500">{fact.sources.map((source) => <details key={`${source.table}:${source.id}`}><summary className="cursor-pointer">{sourceLabels[source.table] ?? "Source record"}{source.updatedAt ? ` · ${source.updatedAt}` : ""}</summary><span className="break-all">Record {source.id} · version {source.revision}</span></details>)}</dd> : null}
            </div>)}
          </dl>
          <p className="text-xs leading-6 text-slate-500">Review records your confirmation of the known facts in this version. Unknowns remain open; editing business details requires a new review.</p>
          <button type="button" className={ownerButton} disabled={busy || !snapshot.canWrite || reviewed || !known.length || snapshot.revision === "unconfigured"} onClick={() => void save({ action: "review_context", key: crypto.randomUUID(), expectedContextRevision: snapshot.revision })}>{reviewed ? "Current facts reviewed" : "Confirm known facts"}</button>
        </section>
        <section className="space-y-4 rounded-xl border p-5">
          <h2 className="font-medium">Effective authority</h2>
          <p className="text-xs leading-6 text-slate-500">Observe allows review of authorized records. Draft prepares work for you. Actions require approval and a supported, connected account. These are the permissions currently available: account access and paused team settings may reduce a saved choice.</p>
          <p className="text-xs">Team: {snapshot.authority.status} · permission revision {snapshot.authority.revision}</p>
          {AUTHORITY_CHANNELS.map((channel) => {
            const value = drafts[channel] ?? snapshot.authority.channels[channel];
            return <div key={channel} className="flex flex-wrap items-end gap-3 border-t pt-4">
              <label className="min-w-40 flex-1 space-y-2 text-sm capitalize">{channel}<select className={ownerInput} value={value} disabled={busy || !snapshot.canWrite} onChange={(event) => setDrafts((current) => ({ ...current, [channel]: event.target.value as AuthorityMode }))}>{AUTHORITY_MODES.map((mode) => <option key={mode} value={mode}>{modeLabels[mode]}</option>)}</select>{value !== snapshot.authority.channels[channel] ? <span className="block text-xs normal-case text-slate-500">Current effective permission: {modeLabels[snapshot.authority.channels[channel]]}. Your choice is unsaved.</span> : null}</label>
              <button type="button" className={ownerButton} disabled={busy || !snapshot.canWrite || value === snapshot.authority.channels[channel]} onClick={() => void save({ action: "set_authority", key: crypto.randomUUID(), expectedRevision: snapshot.authority.revision, channel, mode: value })}>Save {channel}</button>
            </div>;
          })}
        </section>
        <section className="space-y-4 rounded-xl border p-5"><h2 className="font-medium">Sources & coverage</h2>{snapshot.coverage.length ? snapshot.coverage.map((stream) => <div key={stream.key} className="text-sm"><p>{stream.label} · {stream.status}</p><p className="mt-1 text-xs leading-6 text-slate-500">{stream.detail} {stream.lastUpdatedAt ? `Updated ${stream.lastUpdatedAt}. ` : ""}{stream.sampled} records sampled{stream.hasMore ? `; more exist beyond the ${stream.limit}-record limit` : ""}.</p></div>) : <p className="text-sm text-slate-500">No connected source coverage is available yet.</p>}<Link href="/client/apps" className="inline-block text-xs underline">Manage connected apps</Link></section>
        {snapshot.recommendations.length ? <section className="space-y-4 rounded-xl border p-5"><h2 className="font-medium">Suggested responsibilities</h2>{snapshot.recommendations.map((item) => <div key={item.key}><h3 className="text-sm font-medium">{item.label}</h3><p className="mt-1 text-xs leading-6 text-slate-600">{item.reason}</p>{item.prerequisites.length ? <p className="mt-1 text-xs leading-6 text-slate-500">Needs: {item.prerequisites.join("; ")}</p> : null}</div>)}</section> : null}
        {snapshot.observations.length ? <section className="space-y-4 rounded-xl border p-5"><h2 className="font-medium">Observed waiting points</h2>{snapshot.observations.map((item) => <div key={item.key}><p className="text-sm">{item.summary}</p><p className="mt-1 text-xs leading-6 text-slate-500">Since {item.since}. {item.limitation}</p><details className="text-[11px] text-slate-500"><summary className="cursor-pointer">Source evidence</summary>{item.sources.map((source) => <p key={`${source.table}:${source.id}`} className="break-all">{sourceLabels[source.table] ?? "Source record"} · {source.id} · version {source.revision}</p>)}</details></div>)}</section> : null}
        <Link href="/client/activate" className={ownerButton}>Continue to connections & readiness</Link>
      </> : null}
    </div>
  );
}
