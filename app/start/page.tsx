import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { loadFirstOwnerEntry, type FirstOwnerEntry } from "@/lib/auth/first-owner";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FirstOwnerForm } from "./first-owner-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SetupUnavailable } from "@/components/auth/setup-unavailable";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readOwnerSetupReadiness } from "@/lib/auth/owner-setup-readiness";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Set up your business" } };
export default async function FirstOwnerStartPage() {
  const { user, isSupabaseConfigured } = await getAuthState();
  if (!user) {
    const readiness = isSupabaseConfigured
      ? await readOwnerSetupReadiness(createSupabaseAdminClient())
      : { available: false, message: "Owner access is not ready on this site yet." };
    if (readiness.available) redirect("/login?next=%2Fstart");
    return <SetupUnavailable message={readiness.message} />;
  }
  const supabase = await createSupabaseServerClient();
  let message = "Business setup is unavailable. Try again shortly.", canCreate = false;
  let entry: FirstOwnerEntry | null = null;
  if (supabase) {
    try { entry = await loadFirstOwnerEntry(supabase); } catch { /* Access checks fail closed. */ }
  }
  if (entry?.state === "existing") redirect(entry.destination);
  if (entry?.state === "new") {
    const readiness = await readOwnerSetupReadiness(createSupabaseAdminClient());
    canCreate = readiness.available;
    if (!canCreate) message = readiness.message;
  }
  else if (entry?.state === "setup_required") message = "New-business setup is not available on this site yet. Your sign-in is saved. Check again when setup is ready.";
  else if (entry?.state === "blocked") message = entry.reason;
  if (canCreate) return <main className="min-h-dvh bg-white text-slate-900" data-first-owner-onboarding>
    <FirstOwnerForm requestKey={randomUUID()} draftScopeKey={user.id} />
  </main>;
  return <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 [--primary:#1d4ed8] [--primary-foreground:#ffffff] [--ring:#2563eb] [--background:#f8fafc] [--foreground:#0f172a] [--muted-foreground:#64748b] [--border:#e2e8f0] [--input:#cbd5e1]"><section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
    <h1 className="text-2xl font-semibold tracking-tight">Business setup unavailable</h1>
    <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">{message}</p>
    <a href="/start" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700">Check again</a>
    <div className="mt-6"><SignOutButton /></div>
    <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-blue-700" href="/preview">Browse workspace preview</Link>
  </section></main>;
}
