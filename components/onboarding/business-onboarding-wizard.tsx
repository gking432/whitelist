"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { QuestionScreen } from "./question-screen";
import { confirmOnboardingContext, loadBusinessOnboarding, loadOnboardingConnections, loadOnboardingContext, onboardingConnectionNotice, OnboardingRequestError, saveBusinessOnboarding, startOnboardingConnection, type WizardConnections, type WizardContext } from "./onboarding-client";
import { OnboardingRequestSchema, type OnboardingCommand, type OnboardingRequest, type OnboardingSnapshot, type OnboardingStep } from "../../lib/business/onboarding-contract.ts";
import { loadPersonalAssistantPreference, PersonalAssistantRequestError, savePersonalAssistantPreference } from "../../lib/personal-assistant/preferences-client.ts";
import { PERSONAL_ASSISTANT_LABELS, type PersonalAssistantSave, type PersonalAssistantSettings, type PersonalAssistantSnapshot } from "../../lib/personal-assistant/preferences-contract.ts";
import type { OwnerProvider } from "../../lib/connections/types.ts";

const quiet = "inline-flex min-h-11 items-center justify-center rounded-lg px-3 text-sm text-slate-500 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:opacity-40";
const choice = "flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-slate-200 px-5 py-3 text-left text-base focus-within:ring-2 focus-within:ring-blue-600";
const externalAssistants = ["muse", "chatgpt_dot", "grok", "other"] as const;
const factLabels: Record<string, string> = { description: "What your business does", industry: "Business type", goals: "Goals", services: "Services", audience: "Customers", tone: "Voice", hours: "Hours", policies: "Policies", currency: "Currency", website: "Website" };
// The personal-assistant questions stay reachable for saved progress but are not part of the
// first-run path: they offered integrations that do not exist yet.
const positions: Record<OnboardingStep, number> = { description: 1, connections: 2, assistant: 2, assistant_choice: 2, review: 3, permissions: 4, done: 5 };
const TOTAL_STEPS = 5;
const questions: Record<OnboardingStep, string> = { description: "What does your business do?", connections: "Would you like to connect your apps?", assistant: "Do you use a personal AI assistant?", assistant_choice: "Which assistant do you use?", review: "Does this look right?", permissions: "Keep your current permissions?", done: "Your workspace is yours." };
const emptyAssistant: PersonalAssistantSettings = { answer: "unanswered", assistant: null };

/** Remounting on the verified server scope discards all previous private UI. */
export function BusinessOnboardingWizard({ scopeKey, businessName, connectionNotice }: { scopeKey: string; businessName: string; connectionNotice?: string }) {
  return <WizardSession key={scopeKey} scopeKey={scopeKey} businessName={businessName} connectionNotice={onboardingConnectionNotice(connectionNotice)} />;
}
function WizardSession({ scopeKey, businessName, connectionNotice }: { scopeKey: string; businessName: string; connectionNotice: string | null }) {
  const id = useId(), router = useRouter();
  const [snapshot, setSnapshot] = useState<OnboardingSnapshot | null>(null), [description, setDescription] = useState("");
  const [connections, setConnections] = useState<WizardConnections | null>(null), [context, setContext] = useState<WizardContext | null>(null);
  const [assistant, setAssistant] = useState<PersonalAssistantSnapshot | null>(null), [assistantDraft, setAssistantDraft] = useState<PersonalAssistantSettings>(emptyAssistant);
  const [confirmed, setConfirmed] = useState(false), [permissionChoice, setPermissionChoice] = useState<"keep" | "later" | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reloadRequired, setReloadRequired] = useState(false), [denied, setDenied] = useState(false);
  const [reloadSequence, setReloadSequence] = useState(0);
  const lock = useRef(false), pending = useRef<OnboardingRequest | null>(null), assistantPending = useRef<PersonalAssistantSave | null>(null), reviewPending = useRef<{ key: string; revision: string } | null>(null);
  const request = useRef<AbortController | null>(null), dirtyDescription = useRef(false);
  const step = snapshot?.progress.step ?? "description";
  const hasSnapshot = snapshot !== null;
  const blocked = busy || loading || reloadRequired || denied || !snapshot;
  const fail = useCallback((cause: unknown) => {
    const known = cause instanceof OnboardingRequestError || cause instanceof PersonalAssistantRequestError;
    const status = known ? cause.status : 503;
    if (status === 403) {
      setDenied(true); setSnapshot(null); setDescription(""); setConnections(null); setContext(null); setAssistant(null); setAssistantDraft(emptyAssistant); pending.current = null; assistantPending.current = null; reviewPending.current = null;
    }
    if ([400, 413, 422].includes(status)) { pending.current = null; assistantPending.current = null; reviewPending.current = null; }
    setReloadRequired(status === 409 || status >= 500 || status === 403);
    setError(known ? cause.message : "The saved result could not be confirmed. Reload saved setup before continuing.");
  }, []);
  useEffect(() => {
    const controller = new AbortController(); request.current = controller;
    void loadBusinessOnboarding(scopeKey, controller.signal).then(value => {
      if (!controller.signal.aborted) { setSnapshot(value); setDescription(value.answers.description ?? ""); }
    }).catch(cause => { if (!controller.signal.aborted) fail(cause); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); request.current?.abort(); };
  }, [scopeKey, fail]);
  useEffect(() => {
    if (!hasSnapshot || !["connections", "assistant", "assistant_choice", "review"].includes(step)) return;
    const controller = new AbortController(); request.current = controller;
    const operation = step === "connections" ? loadOnboardingConnections(scopeKey, controller.signal).then(value => { if (!controller.signal.aborted) setConnections(value); })
      : step === "review" ? loadOnboardingContext(scopeKey, controller.signal).then(value => { if (!controller.signal.aborted) { setContext(value); setConfirmed(false); } })
        : loadPersonalAssistantPreference(scopeKey, controller.signal).then(value => { if (!controller.signal.aborted) { setAssistant(value); setAssistantDraft({ answer: step === "assistant_choice" ? "yes" : value.preferences.answer, assistant: value.preferences.assistant === "workstation" && step === "assistant_choice" ? null : value.preferences.assistant }); } });
    void operation.catch(cause => { if (!controller.signal.aborted) fail(cause); });
    return () => controller.abort();
    // Only the persisted step starts this read. Saving another revision never
    // refreshes a question or replaces an answer while the owner is typing.
  }, [scopeKey, step, hasSnapshot, reloadSequence, fail]);

  async function operation(action: (signal: AbortSignal) => Promise<void>) {
    if (lock.current || busy || loading || reloadRequired || denied) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    const controller = new AbortController(); request.current = controller;
    try { await action(controller.signal); } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { lock.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  async function save(command: OnboardingCommand, signal: AbortSignal) {
    if (!snapshot) return;
    pending.current ??= { ...command, key: crypto.randomUUID(), revision: snapshot.progress.revision };
    const saved = await saveBusinessOnboarding(scopeKey, pending.current, signal);
    if (signal.aborted) return;
    pending.current = null; setSnapshot(saved.snapshot);
    if (command.action === "answer") { dirtyDescription.current = false; setDescription(saved.snapshot.answers.description ?? ""); }
  }
  const navigate = (target: OnboardingStep) => operation(signal => save({ action: "navigate", step: target }, signal));
  const skip = () => operation(async signal => {
    if (step === "done") return;
    // Skipping the question retains an existing private assistant preference.
    await save({ action: "skip", step }, signal);
  });
  async function reload() {
    if (lock.current || busy) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController(); request.current = controller;
    try {
      const current = await loadBusinessOnboarding(scopeKey, controller.signal);
      if (controller.signal.aborted) return;
      if (!dirtyDescription.current) setDescription(current.answers.description ?? "");
      setConnections(null); setContext(null); setAssistant(null); setSnapshot(current); pending.current = null; assistantPending.current = null; reviewPending.current = null;
      setReloadRequired(false); setDenied(false); setNotice(dirtyDescription.current ? "Saved setup reloaded. Your unsaved text is kept here." : "Saved setup reloaded.");
      // The question effect performs exactly one fresh auxiliary read, including
      // when the saved step has not changed. There is no background polling.
      setReloadSequence(value => value + 1);
    } catch (cause) { if (!controller.signal.aborted) fail(cause); }
    finally { lock.current = false; if (!controller.signal.aborted) { setBusy(false); setLoading(false); } }
  }
  async function saveAssistant(settings: PersonalAssistantSettings, signal: AbortSignal) {
    if (!assistant) return;
    assistantPending.current ??= { key: crypto.randomUUID(), revision: assistant.preferences.revision, settings: { ...settings } };
    const saved = await savePersonalAssistantPreference(scopeKey, assistantPending.current, signal);
    if (signal.aborted) return;
    assistantPending.current = null; setAssistant(saved);
    await save({ action: "navigate", step: "review" }, signal);
  }
  async function next() {
    await operation(async signal => {
      if (!snapshot) return;
      if (step === "description") await save({ action: "answer", field: "description", value: description.trim(), expectedProfileRevision: snapshot.profileRevision }, signal);
      else if (step === "connections") await save({ action: "navigate", step: "review" }, signal);
      else if (step === "assistant") { if (assistantDraft.answer === "yes") await save({ action: "navigate", step: "assistant_choice" }, signal); else if (assistantDraft.answer === "no") await saveAssistant(assistantDraft, signal); }
      else if (step === "assistant_choice") await saveAssistant(assistantDraft, signal);
      else if (step === "review") {
        if (!context) return;
        const known = context.facts.filter(fact => fact.state === "known");
        if (known.length) { if (!confirmed) return; reviewPending.current ??= { key: crypto.randomUUID(), revision: context.revision }; const reviewed = await confirmOnboardingContext(scopeKey, reviewPending.current.key, reviewPending.current.revision, signal); if (signal.aborted) return; setContext(reviewed); reviewPending.current = null; }
        await save({ action: "navigate", step: "permissions" }, signal);
      } else if (step === "permissions" && permissionChoice) await save(permissionChoice === "later" ? { action: "skip", step: "permissions" } : { action: "navigate", step: "done" }, signal);
    });
  }
  async function connect(provider: OwnerProvider, connectionId?: string) {
    await operation(async signal => { const url = await startOnboardingConnection(scopeKey, provider, connectionId, signal); if (!signal.aborted) window.location.assign(url); });
  }
  const known = context?.facts.filter(fact => fact.state !== "unknown") ?? [], conflicts = known.some(fact => fact.state === "conflict");
  const descriptionValid = snapshot && OnboardingRequestSchema.safeParse({ action: "answer", key: "00000000-0000-4000-8000-000000000000", revision: snapshot.progress.revision, field: "description", value: description.trim(), expectedProfileRevision: snapshot.profileRevision }).success;
  const nextDisabled = blocked || step === "description" && !descriptionValid || step === "connections" && !connections || step === "assistant" && (!assistant || !["yes", "no"].includes(assistantDraft.answer)) || step === "assistant_choice" && (!assistant || !assistantDraft.assistant || assistantDraft.assistant === "workstation") || step === "review" && (!context || !context.canWrite || conflicts || known.length > 0 && !confirmed) || step === "permissions" && !permissionChoice;
  const back: Partial<Record<OnboardingStep, OnboardingStep>> = { connections: "description", assistant: "connections", assistant_choice: "assistant", review: "connections", permissions: "review", done: "permissions" };
  const help = step === "description" ? (snapshot?.answers.description ? `We saved this when you created ${businessName}. Edit it or continue.` : `A sentence or two about ${businessName} is enough. You can add services, hours and policies later.`)
    : step === "connections" ? "Optional. Read access brings your existing information together. It does not let assistants send or change anything."
      : step === "assistant" ? "Optional. This is your private preference."
        : step === "assistant_choice" ? "These integrations are not available here yet. Saving a preference does not connect an assistant."
          : step === "review" ? "Confirm only what is known. Missing details stay missing."
            : step === "permissions" ? "Connecting apps and finishing these questions never enables assistants or changes existing pauses."
              : "Your answers are saved. Your current permissions are unchanged.";
  return <div data-business-onboarding data-onboarding-step={step}>
    <QuestionScreen question={denied ? "Business access changed." : questions[step]} step={positions[step]} total={TOTAL_STEPS} help={denied ? "Sign in again before continuing." : help} pending={busy || loading} nextDisabled={!!nextDisabled} nextLabel={step === "description" ? "Next" : step === "review" && known.length ? "Confirm known facts" : step === "permissions" ? "Finish setup" : step === "done" ? "Open workspace" : "Next"} onNext={step === "done" ? () => router.push("/client") : () => void next()} onBack={snapshot && back[step] && !reloadRequired ? () => void navigate(back[step]!) : undefined} onSkip={snapshot && !reloadRequired && !denied && !["permissions", "done"].includes(step) ? () => void skip() : undefined} error={error} notice={notice}>
      {denied ? <Link href="/login?next=%2Fclient%2Fonboarding" className={quiet} prefetch={false}>Sign in</Link> : !snapshot ? <p role="status" className="text-center text-sm text-slate-500">{loading ? "Loading your saved setup…" : "Saved setup is unavailable."}</p> : <>
        {step === "connections" && connectionNotice ? <p role="status" data-onboarding-connection-notice className="mb-5 text-center text-sm leading-7 text-slate-500">{connectionNotice}</p> : null}
        {step === "description" ? <div><label htmlFor={`${id}-description`} className="sr-only">Business description</label><textarea id={`${id}-description`} value={description} onChange={event => { dirtyDescription.current = true; setDescription(event.target.value); }} maxLength={3000} disabled={blocked} rows={5} autoComplete="off" placeholder="We help…" className="w-full resize-y rounded-2xl border border-slate-200 bg-white p-5 text-lg leading-8 text-slate-800 outline-none placeholder:text-slate-300 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 disabled:opacity-50" /><p className="mt-2 text-right text-xs text-slate-400">{description.length}/3000</p></div> : null}
        {step === "connections" ? <div className="space-y-3">{!connections ? <p role="status" className="text-center text-sm text-slate-500">{error ? "App availability could not be loaded." : "Loading available apps…"}</p> : <>
          {connections.apps.length ? <ul className="space-y-2" aria-label="Connected accounts">{connections.apps.slice(0, 8).map(app => <li key={app.id} className="rounded-xl border border-slate-200 px-4 py-3 text-sm"><p className="font-medium">{app.account || app.name}</p><p className="mt-1 text-xs text-slate-500">{app.status === "connected" ? app.paused ? "Connected · Updates paused" : app.readOnly ? "Connected · Read only" : "Connected" : app.status === "needs_attention" ? "Reconnect needed" : "Not connected"}</p>{app.status === "needs_attention" && ["google_workspace", "microsoft_365", "hubspot"].includes(app.provider) ? <button type="button" disabled={blocked || !connections.canWrite} className={quiet} onClick={() => void connect(app.provider as OwnerProvider, app.id)}>Reconnect this account</button> : null}</li>)}</ul> : <p className="text-center text-sm text-slate-500">No apps connected yet.</p>}
          {connections.providers.filter(provider => provider.setup === "oauth").map(provider => <button type="button" key={provider.key} disabled={blocked || !connections.canWrite || !provider.available} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 px-5 py-3 text-left text-sm disabled:opacity-50" onClick={() => void connect(provider.key)}><span>{provider.label}</span><span className="text-xs text-slate-500">{provider.available ? "Connect" : "Setup unavailable"}</span></button>)}
          {connections.providers.some(provider => provider.setup === "oauth" && !provider.available) ? <p className="text-center text-xs leading-6 text-slate-500">Some apps need platform setup first. You can continue and connect them later.</p> : null}
          <p className="text-center text-xs leading-6 text-slate-500">Stripe and website forms can be added later from Apps.</p>
        </>}</div> : null}
        {step === "assistant" ? <fieldset disabled={blocked || !assistant} className="space-y-3"><legend className="sr-only">Do you use a personal AI assistant?</legend>{([{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] as const).map(option => <label key={option.value} className={choice}><input type="radio" name={`${id}-assistant-answer`} checked={assistantDraft.answer === option.value} onChange={() => setAssistantDraft({ answer: option.value, assistant: option.value === "yes" && assistantDraft.assistant !== "workstation" ? assistantDraft.assistant : null })} />{option.label}</label>)}{assistantDraft.answer === "no" ? <div><label className={choice}><input type="checkbox" checked={assistantDraft.assistant === "workstation"} onChange={event => setAssistantDraft({ answer: "no", assistant: event.target.checked ? "workstation" : null })} />Prefer the Workstation assistant</label><p className="mt-3 text-center text-xs leading-6 text-slate-500">Our assistant needs separate setup. Chat is not available yet.</p></div> : null}</fieldset> : null}
        {step === "assistant_choice" ? <fieldset disabled={blocked || !assistant} className="space-y-3"><legend className="sr-only">Which assistant do you use?</legend>{externalAssistants.map(value => <label key={value} className={choice}><input type="radio" name={`${id}-assistant-choice`} checked={assistantDraft.assistant === value} onChange={() => setAssistantDraft({ answer: "yes", assistant: value })} />{PERSONAL_ASSISTANT_LABELS[value]}</label>)}</fieldset> : null}
        {step === "review" ? <div className="space-y-5">{!context ? <p role="status" className="text-center text-sm text-slate-500">{error ? "Current business facts could not be loaded." : "Loading your current facts…"}</p> : known.length ? <><dl className="space-y-4">{known.map(fact => <div key={fact.key}><dt className="text-xs font-medium text-slate-500">{factLabels[fact.key] ?? "Business detail"}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-base leading-7">{Array.isArray(fact.value) ? fact.value.join(", ") : fact.value}</dd>{fact.state === "conflict" ? <dd className="mt-1 text-sm text-amber-800">Details conflict. Review them before confirming.</dd> : null}</div>)}</dl><label className={choice}><input type="checkbox" checked={confirmed} disabled={blocked || conflicts} onChange={event => setConfirmed(event.target.checked)} />I confirm these known facts.</label>{conflicts ? <Link href="/client/business/business" className={quiet}>Review business details</Link> : null}</> : <p className="text-center text-sm leading-7 text-slate-500">No business facts have been entered yet. You can add and review them later.</p>}</div> : null}
        {step === "permissions" ? <fieldset disabled={blocked} className="space-y-3"><legend className="sr-only">Permissions choice</legend><label className={choice}><input type="radio" name={`${id}-permissions`} checked={permissionChoice === "keep"} onChange={() => setPermissionChoice("keep")} />Keep current permissions</label><label className={choice}><input type="radio" name={`${id}-permissions`} checked={permissionChoice === "later"} onChange={() => setPermissionChoice("later")} />Review permissions later</label><p className="pt-2 text-center text-xs leading-6 text-slate-500">Neither choice authorizes new actions.</p><Link href="/client/onboarding/details" className={quiet}>Review permissions in detail</Link></fieldset> : null}
        {step === "done" ? <p className="text-center text-xs leading-6 text-slate-500">You can connect apps and set up your assistant separately.</p> : null}
      </>}
      {reloadRequired || !loading && !snapshot && !denied ? <div className="mt-5 text-center"><button type="button" disabled={busy} className={quiet} onClick={() => void reload()}>Reload saved setup</button></div> : null}
    </QuestionScreen>
  </div>;
}
