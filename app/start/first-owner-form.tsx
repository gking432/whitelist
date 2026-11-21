"use client";
import { useActionState, useState, useSyncExternalStore } from "react";
import { createFirstOwnerBusiness } from "./actions";
import { initialFirstOwnerFormState } from "./state";
import { QuestionScreen } from "@/components/onboarding/question-screen";
import { FIRST_OWNER_FIELDS, firstOwnerDraftErrors, firstOwnerErrorStep, newFirstOwnerDraft, readFirstOwnerDraft, writeFirstOwnerDraft, type FirstOwnerDraft } from "@/components/onboarding/first-owner-draft";

const questions = ["What is your business called?", "What does your business do?", "What timezone does your business use?"];
const labels = ["Business name", "Business description", "Timezone"];
const subscribe = () => () => {};
const input = "w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-lg leading-7 text-slate-900 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-50";
function draftStorage() { try { return window.sessionStorage; } catch { return undefined; } }

export function FirstOwnerForm({ requestKey, draftScopeKey }: { requestKey: string; draftScopeKey: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? <FirstOwnerQuestions key={draftScopeKey} requestKey={requestKey} draftScopeKey={draftScopeKey} /> : <QuestionScreen question={questions[0]} step={1} total={3} nextDisabled><label className="sr-only" htmlFor="business-name">Business name</label><input id="business-name" className={input} disabled /></QuestionScreen>;
}

function FirstOwnerQuestions({ requestKey, draftScopeKey }: { requestKey: string; draftScopeKey: string }) {
  const [draft, setDraft] = useState<FirstOwnerDraft>(() => readFirstOwnerDraft(draftStorage(), draftScopeKey) ?? newFirstOwnerDraft(draftScopeKey, requestKey));
  const [localError, setLocalError] = useState("");
  const [edited, setEdited] = useState(false), [kept, setKept] = useState<boolean | null>(null);
  function keep(next: FirstOwnerDraft) { setDraft(next); setKept(writeFirstOwnerDraft(draftStorage(), next)); }
  const [state, action, pending] = useActionState(async (previous: typeof initialFirstOwnerFormState, data: FormData) => {
    const result = await createFirstOwnerBusiness(previous, data);
    const step = firstOwnerErrorStep(result.fields);
    if (step !== null) keep({ ...draft, step });
    setEdited(false); setLocalError("");
    return result;
  }, initialFirstOwnerFormState);
  const field = FIRST_OWNER_FIELDS[draft.step];
  const error = localError || (!edited ? state.fields?.[field] || state.message : "") || "";
  function next() {
    const errors = firstOwnerDraftErrors(draft);
    if (errors[field] || errors.key) { setLocalError(errors[field] || errors.key); return; }
    setLocalError(""); setEdited(true); keep({ ...draft, step: Math.min(2, draft.step + 1) });
  }
  const control = { id: `business-${field}`, value: draft.values[field], disabled: pending, required: true, "aria-invalid": !!error, "aria-describedby": error ? "first-owner-error" : undefined,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setLocalError(""); setEdited(true); keep({ ...draft, values: { ...draft.values, [field]: event.target.value } }); } };
  return <form action={action} noValidate data-first-owner-questions onSubmit={(event) => {
    if (draft.step < 2) { event.preventDefault(); next(); return; }
    const errors = firstOwnerDraftErrors(draft), step = firstOwnerErrorStep(errors);
    if (step !== null) { event.preventDefault(); keep({ ...draft, step }); setLocalError(errors[FIRST_OWNER_FIELDS[step]] || errors.key); }
  }} onKeyDown={(event) => { if (event.key === "Enter" && draft.step < 2 && event.target instanceof HTMLInputElement) { event.preventDefault(); next(); } }}>
    <input type="hidden" name="key" value={draft.requestKey} />
    <input type="hidden" name="expectedActor" value={draftScopeKey} />
    {FIRST_OWNER_FIELDS.map((name) => <input type="hidden" key={name} name={name} value={draft.values[name]} />)}
    <QuestionScreen question={questions[draft.step]} step={draft.step + 1} total={3} pending={pending} nextType={draft.step === 2 ? "submit" : "button"} nextLabel={draft.step === 2 ? "Create my business" : "Next"} onNext={draft.step < 2 ? next : undefined}
      onBack={draft.step > 0 ? () => { setLocalError(""); setEdited(true); keep({ ...draft, step: draft.step - 1 }); } : undefined}
      error={error} notice={kept === false ? "This browser could not keep a refresh draft. Your answers are still here in this page." : "Draft in this tab only. Your business is created when you finish."}
      help={draft.step === 0 ? "Use the name your customers know." : draft.step === 1 ? "A sentence or two is enough." : "Use an IANA timezone, such as America/Chicago or Europe/London."}>
      <label className="sr-only" htmlFor={control.id}>{labels[draft.step]}</label>
      {field === "description" ? <textarea {...control} rows={4} maxLength={2000} minLength={10} className={input} /> : <input {...control} type="text" maxLength={100} minLength={field === "name" ? 2 : 1} autoComplete={field === "name" ? "organization" : "off"} className={input} placeholder={field === "timezone" ? "America/Chicago" : undefined} />}
      {error ? <span id="first-owner-error" className="sr-only">{error}</span> : null}
    </QuestionScreen>
  </form>;
}
