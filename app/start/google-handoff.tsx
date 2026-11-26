"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { QuestionScreen } from "@/components/onboarding/question-screen";
import { clearGuestOwnerDraft, guestOwnerDraftErrors, readGuestOwnerDraft } from "@/components/onboarding/guest-owner-draft";
import { completeGoogleWorkspace } from "./google-actions";
import { initialGoogleWorkspaceState } from "./google-state";

type Props = { actorId: string; attemptId: string; draftId: string; requestKey: string } & ({ mode: "create" } | { mode: "connect"; clientId: string; businessName: string; revision: number; startAtDescription?: boolean });
const subscribe = () => () => {};
function storage() { try { return window.sessionStorage; } catch { return undefined; } }

export function GoogleWorkspaceHandoff(props: Props) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return hydrated ? <VerifiedHandoff key={`${props.actorId}:${props.attemptId}`} {...props} /> : <QuestionScreen question="Google sign-in is complete." step={4} total={4} nextDisabled><p role="status" className="text-center text-sm text-slate-500">Loading your next step…</p></QuestionScreen>;
}
function VerifiedHandoff(props: Props) {
  const router = useRouter();
  const [draft] = useState(() => {
    const value = readGuestOwnerDraft(storage());
    return value?.draftId === props.draftId && value.requestKey === props.requestKey && Object.keys(guestOwnerDraftErrors(value)).length === 0 ? value : null;
  });
  const [state, action, pending] = useActionState(completeGoogleWorkspace, initialGoogleWorkspaceState);
  const resumeDescription = props.mode === "connect" && props.startAtDescription;
  useEffect(() => {
    if (state.status !== "complete" || !state.destination) return;
    if (state.clearGuest) clearGuestOwnerDraft(storage(), { draftId: props.draftId, requestKey: props.requestKey });
    router.replace(state.destination);
  }, [state, props.draftId, props.requestKey, router]);
  if (props.mode === "create" && !draft) return <QuestionScreen question="Your sign-in is saved." step={4} total={4} nextDisabled help="The answers from your original tab are not available here. You can enter them again without another sign-in."><Link href="/start?restart=1" className="inline-flex min-h-11 items-center text-sm text-blue-700 underline">Enter business answers again</Link></QuestionScreen>;
  return <form action={action} data-google-workspace-handoff={props.mode}>
    <input type="hidden" name="mode" value={props.mode} /><input type="hidden" name="expectedActor" value={props.actorId} />
    <input type="hidden" name="attemptId" value={props.attemptId} /><input type="hidden" name="draftId" value={props.draftId} /><input type="hidden" name="requestKey" value={props.requestKey} />
    {props.mode === "connect" ? <><input type="hidden" name="expectedClient" value={props.clientId} /><input type="hidden" name="revision" value={props.revision} /></> : Object.entries(draft!.values).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <QuestionScreen question={props.mode === "create" ? "Create your workspace?" : resumeDescription ? "Continue your setup?" : "Connect your apps?"} step={4} total={4} nextType="submit" nextLabel={props.mode === "create" ? "Create workspace" : resumeDescription ? "Continue setup" : "Continue to apps"} pending={pending || state.status === "complete"} nextDisabled={!!state.message} error={state.message} help={props.mode === "create" ? "Google verified your sign-in. Confirm these answers to create your workspace. App access comes next." : `Your existing workspace, ${props.businessName}, is ready to resume. Your saved business answers will stay as they are.`}>
      {props.mode === "create" ? <dl className="space-y-4 text-left text-sm leading-7"><div><dt className="text-xs text-slate-500">Business name</dt><dd className="break-words font-medium">{draft!.values.name}</dd></div><div><dt className="text-xs text-slate-500">What your business does</dt><dd className="whitespace-pre-wrap break-words">{draft!.values.description}</dd></div><div><dt className="text-xs text-slate-500">Timezone</dt><dd>{draft!.values.timezone}</dd></div></dl> : <p className="text-center text-sm leading-7 text-slate-500">{resumeDescription ? "Confirm your saved business description first, then choose apps. " : "You will choose an app and approve its read access next. "}Google sign-in alone has not connected Gmail or Calendar.</p>}
      {state.message ? <div className="mt-5 flex justify-center gap-5 text-sm"><a href="/start?google=return" className="inline-flex min-h-11 items-center text-blue-700 underline">Reload setup</a><Link href="/client/onboarding" className="inline-flex min-h-11 items-center text-blue-700 underline">Open saved setup</Link></div> : null}
    </QuestionScreen>
  </form>;
}
