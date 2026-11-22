"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { QuestionScreen } from "./question-screen";
import { GUEST_OWNER_FIELDS, guestOwnerDraftErrors, newGuestOwnerDraft, readGuestOwnerDraft, startGuestGoogleAuthorization, writeGuestOwnerDraft, type GuestOwnerDraft, type GuestOwnerStep } from "./guest-owner-draft";

const questions = ["What is your business called?", "What does your business do?", "What timezone does your business use?", "Ready to continue with Google?"];
const labels = ["Business name", "Business description", "Timezone"];
const inputClass = "w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-lg leading-7 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-50";
const subscribe = () => () => {};
function storage() { try { return window.sessionStorage; } catch { return undefined; } }

export function GuestOwnerForm({ googleAvailable, notice }: { googleAvailable: boolean; notice?: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? <GuestOwnerQuestions googleAvailable={googleAvailable} notice={notice} /> : <div data-guest-owner-form data-guest-step="0"><QuestionScreen question={questions[0]} step={1} total={4} nextDisabled><label htmlFor="guest-business-name" className="sr-only">Business name</label><input id="guest-business-name" className={inputClass} disabled /></QuestionScreen></div>;
}
function GuestOwnerQuestions({ googleAvailable, notice }: { googleAvailable: boolean; notice?: string }) {
  const [draft, setDraft] = useState<GuestOwnerDraft>(() => readGuestOwnerDraft(storage()) ?? newGuestOwnerDraft(crypto.randomUUID(), crypto.randomUUID()));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [kept, setKept] = useState<boolean | null>(null);
  const lock = useRef(false), request = useRef<AbortController | null>(null), generation = useRef(0);
  useEffect(() => {
    const invalidate = () => { generation.current++; request.current?.abort(); request.current = null; };
    const hide = () => { invalidate(); lock.current = true; };
    const show = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      // A successful location.assign leaves this page pending while away.
      // BFCache Back restores the same component, not a fresh initial render.
      invalidate(); lock.current = false; setBusy(false); setError("");
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => { invalidate(); window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", show); };
  }, []);
  const field = GUEST_OWNER_FIELDS[Math.min(draft.step, 2)];
  function keep(next: GuestOwnerDraft) { setDraft(next); const saved = writeGuestOwnerDraft(storage(), next); setKept(saved); return saved; }
  async function next() {
    if (lock.current || busy) return;
    const errors = guestOwnerDraftErrors(draft);
    if (draft.step < 3) {
      if (errors[field] || errors.key) { setError(errors[field] || errors.key); return; }
      setError(""); keep({ ...draft, step: draft.step + 1 as GuestOwnerStep }); return;
    }
    const invalid = GUEST_OWNER_FIELDS.findIndex(name => errors[name]);
    if (invalid >= 0 || errors.key) { keep({ ...draft, step: Math.max(0, invalid) as GuestOwnerStep }); setError(errors[GUEST_OWNER_FIELDS[Math.max(0, invalid)]] || errors.key); return; }
    if (!googleAvailable) { setError("Google sign-in is not available here yet. Your answers stay in this tab."); return; }
    if (!keep(draft)) { setError("This browser could not keep your answers. Allow tab storage before continuing with Google."); return; }
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController(), currentGeneration = ++generation.current; request.current = controller;
    const current = () => generation.current === currentGeneration && request.current === controller && !controller.signal.aborted;
    let leaving = false;
    try {
      const url = await startGuestGoogleAuthorization({ draftId: draft.draftId, requestKey: draft.requestKey }, process.env.NEXT_PUBLIC_SUPABASE_URL, controller.signal);
      if (current()) { window.location.assign(url); leaving = true; }
    } catch { if (current()) setError("Google sign-in could not be started. Your answers stay in this tab. Try again when you are ready."); }
    finally { if (!leaving && current()) { request.current = null; lock.current = false; setBusy(false); } }
  }
  const final = draft.step === 3, control = { id: `guest-business-${field}`, value: draft.values[field] ?? "", required: true, disabled: busy, "aria-invalid": !!error, "aria-describedby": error ? "guest-owner-error" : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setError(""); keep({ ...draft, values: { ...draft.values, [field]: event.target.value } }); } };
  const draftNotice = kept === false ? "This browser could not keep a refresh draft. Your answers are still here in this page." : "Your answers are a draft in this tab until you finish setup.";
  return <form data-guest-owner-form data-guest-step={draft.step} aria-busy={busy} onSubmit={event => { event.preventDefault(); void next(); }} onKeyDown={event => { if (event.key === "Enter" && draft.step < 3 && event.target instanceof HTMLInputElement) { event.preventDefault(); void next(); } }}>
    <QuestionScreen question={questions[draft.step]} step={draft.step + 1} total={4} pending={busy} nextDisabled={final && !googleAvailable} nextLabel={final ? "Continue with Google" : "Next"} onNext={() => void next()} onBack={draft.step > 0 ? () => { if (!busy && !lock.current) { setError(""); keep({ ...draft, step: draft.step - 1 as GuestOwnerStep }); } } : undefined}
      error={error} notice={draftNotice} help={draft.step === 0 ? "Use the name your customers know." : draft.step === 1 ? "A sentence or two is enough." : draft.step === 2 ? "For example, America/Chicago or Europe/London." : "Securely continue with Google. App permissions come next."}>
      {final ? <div className="space-y-3 text-center text-sm leading-7 text-slate-500">{notice ? <p role="status">{notice.slice(0, 300)}</p> : null}{!googleAvailable ? <p role="status">Google sign-in is not available here yet. Your answers stay in this tab.</p> : <p>This step signs you in. It does not connect Gmail or Calendar.</p>}</div> : <>
        <label htmlFor={control.id} className="sr-only">{labels[draft.step]}</label>
        {field === "description" ? <textarea {...control} rows={4} minLength={10} maxLength={2000} className={inputClass} /> : <input {...control} type="text" minLength={field === "name" ? 2 : 1} maxLength={100} autoComplete={field === "name" ? "organization" : "off"} placeholder={field === "timezone" ? "America/Chicago" : undefined} className={inputClass} />}
      </>}
      {error ? <span id="guest-owner-error" className="sr-only">{error}</span> : null}
    </QuestionScreen>
  </form>;
}
