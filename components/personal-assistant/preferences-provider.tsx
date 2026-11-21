"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { PersonalAssistantRequestError, loadPersonalAssistantPreference, savePersonalAssistantPreference } from "@/lib/personal-assistant/preferences-client";
import { PersonalAssistantSettingsSchema, type PersonalAssistantSave, type PersonalAssistantSettings, type PersonalAssistantSnapshot } from "@/lib/personal-assistant/preferences-contract";

const emptySettings: PersonalAssistantSettings = { answer: "unanswered", assistant: null };
type State = {
  snapshot: PersonalAssistantSnapshot | null; draft: PersonalAssistantSettings; busy: boolean; error: string; notice: string; reloadRequired: boolean;
  change(settings: PersonalAssistantSettings): void; save(settings?: PersonalAssistantSettings): Promise<void>; reload(): Promise<void>;
};
const PreferencesContext = createContext<State | null>(null);

/** Keyed by the server's actor/business scope. Nothing is stored in the browser. */
export function PersonalAssistantPreferencesProvider({ children, scopeKey }: { children: ReactNode; scopeKey: string }) {
  const [snapshot, setSnapshot] = useState<PersonalAssistantSnapshot | null>(null), [draft, setDraft] = useState<PersonalAssistantSettings>(emptySettings);
  const [busy, setBusy] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reloadRequired, setReloadRequired] = useState(false);
  const lock = useRef(false), pending = useRef<PersonalAssistantSave | null>(null), request = useRef<AbortController | null>(null);
  function adopt(value: PersonalAssistantSnapshot) {
    setSnapshot(value); setDraft({ answer: value.preferences.answer, assistant: value.preferences.assistant });
  }
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void loadPersonalAssistantPreference(scopeKey, controller.signal).then((value) => { if (!controller.signal.aborted) adopt(value); }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { if (cause instanceof PersonalAssistantRequestError && cause.status === 403) { setSnapshot(null); setDraft(emptySettings); } setError(cause instanceof PersonalAssistantRequestError ? cause.message : "Personal assistant preferences are unavailable."); }
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [scopeKey]);
  function change(settings: PersonalAssistantSettings) {
    if (lock.current || busy || reloadRequired) return;
    setDraft(settings); setError(""); setNotice("");
  }
  async function save(settings = draft) {
    if (lock.current || busy || reloadRequired || !snapshot?.canEdit || !PersonalAssistantSettingsSchema.safeParse(settings).success) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const command = pending.current ?? { key: crypto.randomUUID(), revision: snapshot.preferences.revision, settings: { ...settings } };
    pending.current = command;
    const controller = new AbortController(); request.current = controller;
    try {
      const saved = await savePersonalAssistantPreference(scopeKey, command, controller.signal);
      if (controller.signal.aborted) return;
      pending.current = null; adopt(saved); setReloadRequired(false); setNotice(command.settings.answer === "unanswered" ? "Assistant preference reset." : "Assistant preference saved.");
    } catch (cause) {
      if (controller.signal.aborted) return;
      const known = cause instanceof PersonalAssistantRequestError && [400, 403, 409, 413].includes(cause.status);
      if (known) pending.current = null;
      if (cause instanceof PersonalAssistantRequestError && cause.status === 403) { setSnapshot(null); setDraft(emptySettings); }
      setReloadRequired(!known || cause instanceof PersonalAssistantRequestError && cause.status === 409); setError(cause instanceof PersonalAssistantRequestError ? cause.message : "The saved preference could not be confirmed. Reload it before trying again.");
    } finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function reload() {
    if (lock.current || busy) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); request.current = controller;
    try {
      const saved = await loadPersonalAssistantPreference(scopeKey, controller.signal);
      if (controller.signal.aborted) return;
      adopt(saved); pending.current = null; setReloadRequired(false); setNotice("Saved assistant preference loaded.");
    } catch (cause) {
      if (!controller.signal.aborted) { if (cause instanceof PersonalAssistantRequestError && cause.status === 403) { setSnapshot(null); setDraft(emptySettings); } setError(cause instanceof PersonalAssistantRequestError ? cause.message : "Your saved preference could not be loaded. Your current choice is still here."); }
    } finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  return <PreferencesContext.Provider value={{ snapshot, draft, busy, error, notice, reloadRequired, change, save, reload }}>{children}</PreferencesContext.Provider>;
}
export function usePersonalAssistantPreferences() { return useContext(PreferencesContext); }
