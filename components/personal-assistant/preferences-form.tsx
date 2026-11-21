"use client";

import { useId } from "react";
import { PERSONAL_ASSISTANT_LABELS, PersonalAssistantSettingsSchema, type PersonalAssistantSettings } from "@/lib/personal-assistant/preferences-contract";
import { usePersonalAssistantPreferences } from "./preferences-provider";

const button = "inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const external = ["muse", "chatgpt_dot", "grok", "other"] as const;
export function PersonalAssistantPreferencesForm() {
  const state = usePersonalAssistantPreferences(), id = useId();
  if (!state) return null;
  const { snapshot, draft, busy, reloadRequired, error, notice } = state;
  const disabled = busy || reloadRequired || !snapshot?.canEdit;
  const valid = PersonalAssistantSettingsSchema.safeParse(draft).success && draft.answer !== "unanswered";
  function answer(value: PersonalAssistantSettings["answer"]) {
    if (!state) return;
    const assistant = value === "yes" && state.draft.assistant !== "workstation" ? state.draft.assistant : value === "no" && state.draft.assistant === "workstation" ? "workstation" : null;
    state.change({ answer: value, assistant });
  }
  return <form onSubmit={(event) => { event.preventDefault(); void state.save(); }} aria-busy={busy} className="space-y-4" data-personal-assistant-form>
    <fieldset disabled={disabled} className="space-y-3">
      <legend className="text-sm font-semibold text-slate-900">Do you use a personal AI assistant?</legend>
      <p className="text-xs leading-6 text-slate-500">Optional. You can change or reset this choice later.</p>
      <div className="flex flex-wrap gap-2">{([{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "skipped", label: "Skip for now" }] as const).map((option) => <label key={option.value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm"><input type="radio" name={`${id}-answer`} value={option.value} checked={draft.answer === option.value} onChange={() => answer(option.value)} />{option.label}</label>)}</div>
      {draft.answer === "yes" ? <fieldset className="space-y-2"><legend className="text-sm font-medium">Which assistant do you use?</legend>{external.map((assistant) => <label key={assistant} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm"><input type="radio" name={`${id}-assistant`} checked={draft.assistant === assistant} onChange={() => state.change({ answer: "yes", assistant })} />{PERSONAL_ASSISTANT_LABELS[assistant]}</label>)}<p className="text-xs leading-6 text-slate-500">These integrations are unavailable here. Saving your choice does not connect an account.</p></fieldset> : null}
      {draft.answer === "no" ? <div className="space-y-2"><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 px-3 text-sm"><input type="checkbox" checked={draft.assistant === "workstation"} onChange={(event) => state.change({ answer: "no", assistant: event.target.checked ? "workstation" : null })} />Prefer the Workstation assistant</label><p className="text-xs leading-6 text-slate-500">Our text assistant needs separate setup. Chat is not available yet.</p></div> : null}
    </fieldset>
    {busy ? <p className="text-xs text-slate-500">{snapshot ? "Saving or loading your preference…" : "Loading your saved preference…"}</p> : null}
    {error ? <p role="alert" className="text-sm leading-6 text-amber-900">{error}</p> : null}
    {notice ? <p role="status" className="text-sm leading-6 text-emerald-800">{notice}</p> : null}
    <div className="flex flex-wrap gap-2"><button type="submit" disabled={disabled || !valid} className={`${button} font-medium`}>Save assistant preference</button><button type="button" disabled={disabled || snapshot?.preferences.answer === "unanswered" && draft.answer === "unanswered"} className={button} onClick={() => void state.save({ answer: "unanswered", assistant: null })}>Reset assistant preference</button></div>
    {error || reloadRequired ? <div><button type="button" disabled={busy} className={button} onClick={() => void state.reload()}>Reload saved preference</button><p className="mt-1 text-xs leading-5 text-slate-500">Reloading replaces the current choice with the saved preference.</p></div> : null}
  </form>;
}
