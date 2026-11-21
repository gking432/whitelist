"use client";

import { useEffect, useRef, useState } from "react";
import { PersonalAssistantPreferencesForm } from "./preferences-form";
import { usePersonalAssistantPreferences } from "./preferences-provider";
import { assistantPreferenceSummary, assistantStatusLabel } from "./presentation";

/** Observe existing call surfaces only; never change voice or call state. */
function callSurfaceVisible() {
  return Array.from(document.querySelectorAll<HTMLElement>(".fixed")).some((element) => element.classList.contains("z-[80]") && element.getClientRects().length > 0);
}
export function PersonalAssistantLauncher({ mobileNavigation = false }: { mobileNavigation?: boolean }) {
  const state = usePersonalAssistantPreferences(), details = useRef<HTMLDetailsElement>(null), summary = useRef<HTMLElement>(null);
  const [callVisible, setCallVisible] = useState(false);
  useEffect(() => {
    const update = () => {
      const visible = callSurfaceVisible(); setCallVisible(visible);
      if (visible && details.current) details.current.open = false;
    };
    update(); const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, []);
  if (!state) return null;
  return <details ref={details} hidden={callVisible} className={`fixed right-4 z-50 ${mobileNavigation ? "bottom-[calc(6rem_+_env(safe-area-inset-bottom))]" : "bottom-[max(1rem,env(safe-area-inset-bottom))]"} rounded-xl border border-slate-200 bg-white shadow-lg lg:bottom-5 lg:right-5`} onKeyDown={(event) => { if (event.key === "Escape" && details.current?.open) { details.current.open = false; summary.current?.focus(); } }} data-personal-assistant-launcher>
    <summary ref={summary} className="flex min-h-11 cursor-pointer list-none items-center px-4 text-sm font-medium text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600" aria-label="Personal assistant">Personal assistant</summary>
    <section aria-label="Personal assistant preferences" className="absolute bottom-full right-0 mb-3 max-h-[min(70dvh,36rem)] w-[min(24rem,calc(100vw-2rem))] space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5 shadow-xl" data-personal-assistant-panel>
      <div><h2 className="font-semibold text-slate-900">Your personal assistant</h2><p className="mt-2 text-xs leading-6 text-slate-500">A personal preference for you, separate from your shared business manager.</p></div>
      {state.snapshot ? <div className="rounded-lg bg-slate-50 p-3 text-sm"><p className="font-medium" data-personal-assistant-selected>{assistantPreferenceSummary(state.snapshot.preferences)}</p><p className="mt-1 text-xs font-medium text-slate-600" data-personal-assistant-status>{assistantStatusLabel(state.snapshot.connection.state)}</p><p className="mt-1 text-xs leading-6 text-slate-500">{state.snapshot.connection.detail}</p><p className="mt-1 text-xs leading-6 text-slate-500">Text chat is not available yet.</p></div> : null}
      <PersonalAssistantPreferencesForm />
      <button type="button" className="min-h-11 rounded-lg px-3 text-sm text-slate-600 underline" onClick={() => { if (details.current) details.current.open = false; summary.current?.focus(); }}>Close personal assistant</button>
    </section>
  </details>;
}
