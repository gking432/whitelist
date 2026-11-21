"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_MODULES, WORKSPACE_MODULE_LABELS, type WorkspaceModule, type WorkspacePersonalization, type WorkspacePreferences } from "../../lib/business/workspace-preferences-contract.ts";
import { parseWorkspacePreferences } from "../../lib/business/workspace-preferences.ts";

const buttonBase = "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm disabled:cursor-not-allowed disabled:opacity-40";
const button = `${buttonBase} border-slate-200 bg-white text-slate-700 hover:bg-slate-50`;
const primaryButton = `${buttonBase} border-slate-800 bg-slate-800 text-white hover:bg-slate-700`;
type PreferenceCommand = { action: "save"; requestKey: string; revision: number; displayName: string | null; order: WorkspaceModule[]; pinned: WorkspaceModule[] }
  | { action: "reset"; requestKey: string; revision: number };
type PreferenceResult = { state: "saved"; snapshot: WorkspacePersonalization }
  | { state: "stale" | "denied" | "invalid" | "unknown"; error: string };
const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const copy = (preferences: WorkspacePreferences): WorkspacePreferences => ({ ...preferences, order: [...preferences.order], pinned: [...preferences.pinned] });

/** Confirm a saved response before applying any arrangement to Today. */
export function readPreferenceSnapshot(value: unknown): WorkspacePersonalization | null {
  const data = record(value), preferences = parseWorkspacePreferences(data?.preferences);
  if (!data || !preferences || typeof data.available !== "boolean" || typeof data.canEdit !== "boolean" || !Array.isArray(data.activity) || data.activity.length > 4) return null;
  const activity = data.activity.map(record);
  if (activity.some((row) => !row || !(WORKSPACE_MODULES as readonly unknown[]).includes(row.module) || !Number.isSafeInteger(row.days) || Number(row.days) < 0 || Number(row.days) > 14) || new Set(activity.map((row) => row!.module)).size !== activity.length) return null;
  return { preferences, activity: activity.map((row) => ({ module: row!.module as WorkspaceModule, days: Number(row!.days) })), available: data.available, canEdit: data.canEdit };
}

/** A lost/ambiguous response keeps the exact command available for safe retry. */
export async function savePreferenceCommand(command: PreferenceCommand, request: typeof fetch = fetch): Promise<PreferenceResult> {
  try {
    const response = await request("/api/business/workspace-preferences", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
    const data = record(await response.json().catch(() => null));
    const error = typeof data?.error === "string" ? data.error.slice(0, 500) : "Your preferences could not be saved.";
    if (response.ok) {
      const snapshot = readPreferenceSnapshot(data?.snapshot);
      return snapshot?.available ? { state: "saved", snapshot } : { state: "unknown", error: "The saved preferences could not be confirmed. Retry this change or reload saved preferences." };
    }
    return { state: response.status === 409 ? "stale" : response.status === 403 ? "denied" : response.status >= 400 && response.status < 500 ? "invalid" : "unknown", error };
  } catch { return { state: "unknown", error: "The result could not be confirmed. Retry this change or reload saved preferences." }; }
}

export function WorkspacePreferencesPanel({ snapshot, recommendation, preview = false }: {
  snapshot: WorkspacePersonalization; recommendation?: WorkspaceModule | null; preview?: boolean;
}) {
  const router = useRouter(), nameId = useId();
  const [saved, setSaved] = useState(snapshot), [draft, setDraft] = useState(() => copy(snapshot.preferences));
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [stale, setStale] = useState(false), [uncertain, setUncertain] = useState(false), [denied, setDenied] = useState(false);
  const lock = useRef(false), pending = useRef<PreferenceCommand | null>(null);
  const available = snapshot.available && saved.available;
  const canEdit = available && snapshot.canEdit && saved.canEdit && !preview && !denied;
  const disabled = !canEdit || busy || uncertain;
  const changedElsewhere = snapshot.preferences.revision > saved.preferences.revision;
  const suggestion = recommendation ?? null;
  const activityDays = suggestion ? Math.max(0, ...snapshot.activity.filter((entry) => entry.module === suggestion).map((entry) => entry.days)) : 0;
  const first = draft.order.find((module) => draft.pinned.includes(module)) ?? draft.order[0];
  const suggestionBlockedByPins = !!suggestion && draft.pinned.length > 0 && !draft.pinned.includes(suggestion);

  async function commit(action: "save" | "reset") {
    if (lock.current || !canEdit) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const command = pending.current ?? (action === "reset" ? { action, requestKey: crypto.randomUUID(), revision: saved.preferences.revision } : {
      action, requestKey: crypto.randomUUID(), revision: saved.preferences.revision, displayName: draft.displayName?.trim() || null, order: [...draft.order], pinned: [...draft.pinned],
    });
    pending.current = command;
    try {
      const result = await savePreferenceCommand(command);
      if (result.state === "saved") {
        pending.current = null; setUncertain(false); setStale(false); setDenied(false);
        setSaved(result.snapshot); setDraft(copy(result.snapshot.preferences));
        setNotice(command.action === "reset" ? "Default preferences restored." : "Today preferences saved."); router.refresh();
      } else {
        if (result.state !== "unknown") pending.current = null;
        setUncertain(result.state === "unknown"); setStale(result.state === "stale"); setDenied(result.state === "denied"); setError(result.error);
      }
    } finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    if (lock.current || preview) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/business/workspace-preferences", { cache: "no-store" });
      const current = readPreferenceSnapshot(await response.json().catch(() => null));
      if (!response.ok || !current) throw new Error("Saved preferences could not be loaded. Your draft is still here.");
      setSaved(current); setDraft(copy(current.preferences)); pending.current = null; setUncertain(false); setStale(false); setDenied(false);
      setNotice(current.available ? "Saved preferences loaded." : "Preferences are temporarily unavailable."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Preferences are unavailable. Your draft is still here."); }
    finally { lock.current = false; setBusy(false); }
  }
  function move(module: WorkspaceModule, delta: number) {
    setDraft((current) => {
      const order = [...current.order], index = order.indexOf(module), next = index + delta;
      if (next < 0 || next >= order.length) return current;
      [order[index], order[next]] = [order[next], order[index]];
      return { ...current, order };
    });
  }
  return <details className="relative shrink-0 rounded-xl border border-slate-200 bg-white text-sm" aria-label="Today preferences">
    <summary className="flex min-h-11 cursor-pointer items-center px-4 font-medium text-slate-600">Customize Today</summary>
    <div className="absolute right-0 top-full z-40 mt-2 max-h-[75dvh] w-[min(26rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-left shadow-lg">
      <p className="text-xs leading-6 text-slate-500">Choose your name and section order. Pinned sections stay first; urgent decisions stay visible. Save to apply.</p>
      {preview ? <p className="text-xs text-slate-500">Preview only. Preferences are not saved here.</p> : !available ? <p className="text-xs text-amber-800">Preferences are temporarily unavailable. Reload to try again.</p> : !canEdit && !denied ? <p className="text-xs text-slate-500">You have view-only access to these preferences.</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void commit("save"); }} aria-busy={busy}>
        <fieldset disabled={disabled} className="space-y-4">
          <div><label htmlFor={nameId} className="text-sm font-medium text-slate-700">Preferred name</label><input id={nameId} type="text" autoComplete="given-name" maxLength={60} value={draft.displayName ?? ""} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-200 px-3 disabled:bg-slate-50" /><p className="mt-1 text-xs leading-5 text-slate-500">Used for your Today greeting. Leave blank to use your account name.</p></div>
          <ol aria-label="Today section order" className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {draft.order.map((module, index) => <li key={module} data-workspace-module={module} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
              <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={draft.pinned.includes(module)} onChange={(event) => { const checked = event.target.checked; setDraft((current) => ({ ...current, pinned: checked ? [...current.pinned, module] : current.pinned.filter((value) => value !== module) })); }} /><span>Pin {WORKSPACE_MODULE_LABELS[module]}</span></label>
              <div className="flex gap-1"><button type="button" aria-label={`Move ${WORKSPACE_MODULE_LABELS[module]} up`} disabled={index === 0} className={`${button} min-w-11 px-2`} onClick={() => move(module, -1)}>↑</button><button type="button" aria-label={`Move ${WORKSPACE_MODULE_LABELS[module]} down`} disabled={index === draft.order.length - 1} className={`${button} min-w-11 px-2`} onClick={() => move(module, 1)}>↓</button></div>
            </li>)}
          </ol>
          {suggestion && activityDays >= 3 ? <div data-workspace-recommendation={suggestion} className="rounded-lg bg-slate-50 p-3 text-xs leading-6 text-slate-600"><p>You opened {WORKSPACE_MODULE_LABELS[suggestion]} on {activityDays} of the last 14 days.</p><button type="button" disabled={first === suggestion || suggestionBlockedByPins} className={`${button} mt-2`} onClick={() => setDraft((current) => ({ ...current, order: [suggestion, ...current.order.filter((module) => module !== suggestion)] }))}>Make {WORKSPACE_MODULE_LABELS[suggestion]} first</button><p className="mt-1">{suggestionBlockedByPins ? `Pin ${WORKSPACE_MODULE_LABELS[suggestion]} or unpin other sections to put it first.` : first === suggestion ? `${WORKSPACE_MODULE_LABELS[suggestion]} is already first.` : "Save to apply this suggestion."}</p></div> : null}
          <div className="flex flex-wrap gap-2"><button type="submit" className={primaryButton}>{busy ? "Saving…" : "Save preferences"}</button><button type="button" className={button} onClick={() => void commit("reset")}>Reset preferences</button></div>
        </fieldset>
      </form>
      {uncertain ? <button type="button" className={button} disabled={busy || !canEdit} onClick={() => void commit("save")}>{busy ? "Checking…" : "Retry change"}</button> : null}
      {error ? <p role="alert" className="text-xs leading-6 text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="text-xs leading-6 text-slate-600">{notice}</p> : null}
      {stale || uncertain || denied || changedElsewhere || !available ? <div className="space-y-1 text-xs leading-6 text-slate-500">{stale || changedElsewhere ? <p>Saved preferences changed. Your draft is kept here.</p> : null}<button type="button" className={button} disabled={busy || preview} onClick={() => void reload()}>Reload saved preferences</button><p>Reloading replaces this draft with the current saved preferences.</p></div> : null}
    </div>
  </details>;
}
