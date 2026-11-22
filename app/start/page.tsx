import { randomUUID } from "node:crypto";
import { parseCookieHeader } from "@supabase/ssr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getAuthState } from "@/lib/auth/session";
import { loadFirstOwnerEntry, type FirstOwnerEntry } from "@/lib/auth/first-owner";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FirstOwnerForm } from "./first-owner-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readOwnerSetupReadiness } from "@/lib/auth/owner-setup-readiness";
import { GuestOwnerForm } from "@/components/onboarding/guest-owner-form";
import { GOOGLE_ONBOARDING_HANDOFF_COOKIE, isGoogleOnboardingConfigured, readGoogleOnboardingHandoff, readGoogleOnboardingSessionId } from "@/lib/auth/google-onboarding";
import { GoogleWorkspaceHandoff } from "./google-handoff";
import { loadClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { OnboardingSnapshotSchema } from "@/lib/business/onboarding-contract";
import { firstOwnerSameOrigin } from "@/lib/auth/first-owner-rules";
import { getAppUrl } from "@/lib/env";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Set up your business" } };
const notices: Record<string, string> = {
  unavailable: "Google setup is not ready here yet. Your answers are kept in this tab.",
  expired: "That Google sign-in attempt expired. Your answers are kept; you can start again.",
  denied: "Google sign-in was not approved. Your answers are kept in this tab.",
  changed: "Your sign-in changed while Google setup was open. Start again from this tab.",
  failed: "Google sign-in could not be confirmed. Your answers are kept in this tab.",
};
export default async function FirstOwnerStartPage(props: { searchParams: Promise<{ google?: string; restart?: string }> }) {
  const query = props?.searchParams ? await props.searchParams : {};
  const auth = await getAuthState().catch(() => null);
  const user = auth?.user;
  if (!user) {
    // Public local answers are independent of Auth, database and provider
    // availability. None of the private wizard's data is mounted here.
    return <main className="min-h-dvh bg-white text-slate-900" data-guest-owner-onboarding><GuestOwnerForm googleAvailable={isGoogleOnboardingConfigured()} notice={typeof query.google === "string" ? notices[query.google] : undefined} /></main>;
  }
  const supabase = await createSupabaseServerClient();
  let message = "Business setup is unavailable. Try again shortly.", canCreate = false;
  let entry: FirstOwnerEntry | null = null;
  if (supabase) {
    try { entry = await loadFirstOwnerEntry(supabase); } catch { /* Access checks fail closed. */ }
  }
  let handoff = null;
  if (query.google === "return" && query.restart !== "1" && supabase) {
    let carrier = (await cookies()).get(GOOGLE_ONBOARDING_HANDOFF_COOKIE)?.value;
    if (!carrier) {
      const incoming = await headers();
      // Cookie deletion rerenders this same Server Action request. Preserve
      // its navigation UI until the client receives the successful result;
      // the browser still receives the actual cookie deletion. This marker
      // grants no access: the original carrier must pass fresh actor/SID/TTL
      // checks below. Never recover an Auth cookie or use this on a plain GET.
      if (incoming.get("next-action") && firstOwnerSameOrigin(incoming.get("origin"), getAppUrl())) {
        // Count before parsing: the SDK's cookie parser collapses duplicates.
        const original = (incoming.get("cookie") ?? "").split(";").map(part => part.trim()).filter(part => part.indexOf("=") > 0 && part.slice(0, part.indexOf("=")).trim() === GOOGLE_ONBOARDING_HANDOFF_COOKIE);
        if (original.length === 1) carrier = parseCookieHeader(original[0]).find(cookie => cookie.name === GOOGLE_ONBOARDING_HANDOFF_COOKIE)?.value;
      }
    }
    const sessionId = carrier ? await readGoogleOnboardingSessionId(supabase, user.id).catch(() => null) : null;
    handoff = sessionId ? readGoogleOnboardingHandoff(carrier, user.id, sessionId) : null;
  }
  if (entry?.state === "existing") {
    if (handoff && entry.destination === "/client" && supabase) {
      const portal = await loadClientPortal();
      if (portal.kind === "ok" && portal.user.id === user.id && portal.access.role === "client_owner" && !portal.access.isImpersonating && canWriteBusinessWorkspace(portal.access)) {
        const source = await supabase.rpc("get_owner_onboarding", { p_client: portal.client.id });
        const saved = !source.error ? OnboardingSnapshotSchema.safeParse(source.data) : null;
        if (saved?.success) return <main className="min-h-dvh bg-white text-slate-900"><GoogleWorkspaceHandoff mode="connect" actorId={user.id} attemptId={handoff.attemptId} draftId={handoff.draftId} requestKey={handoff.requestKey} clientId={portal.client.id} businessName={portal.client.name} revision={saved.data.progress.revision} {...(saved.data.progress.revision === 0 ? { startAtDescription: true } : {})} /></main>;
      }
    }
    redirect(entry.destination);
  }
  if (entry?.state === "new") {
    const readiness = await readOwnerSetupReadiness(createSupabaseAdminClient());
    canCreate = readiness.available;
    if (!canCreate) message = readiness.message;
  }
  else if (entry?.state === "setup_required") message = "New-business setup is not available on this site yet. Your sign-in is saved. Check again when setup is ready.";
  else if (entry?.state === "blocked") message = entry.reason;
  if (canCreate) return <main className="min-h-dvh bg-white text-slate-900" data-first-owner-onboarding>
    {handoff ? <GoogleWorkspaceHandoff mode="create" actorId={user.id} attemptId={handoff.attemptId} draftId={handoff.draftId} requestKey={handoff.requestKey} /> : <FirstOwnerForm requestKey={randomUUID()} draftScopeKey={user.id} />}
  </main>;
  return <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 [--primary:#1d4ed8] [--primary-foreground:#ffffff] [--ring:#2563eb] [--background:#f8fafc] [--foreground:#0f172a] [--muted-foreground:#64748b] [--border:#e2e8f0] [--input:#cbd5e1]"><section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
    <h1 className="text-2xl font-semibold tracking-tight">Business setup unavailable</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">{message}</p>
    <a href="/start" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700">Check again</a>
    <div className="mt-6"><SignOutButton /></div>
    <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-blue-700" href="/preview">Browse workspace preview</Link>
  </section></main>;
}
