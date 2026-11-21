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
  if (entry?.state === "new") canCreate = true;
  else if (entry?.state === "setup_required") message = "New-business setup is not available on this site yet. Your sign-in is saved. Check again when setup is ready.";
  else if (entry?.state === "blocked") message = entry.reason;
  return <main className="min-h-screen bg-slate-50 px-6 py-12 text-slate-900 [--primary:#1d4ed8] [--primary-foreground:#ffffff] [--ring:#2563eb] [--background:#f8fafc] [--foreground:#0f172a] [--muted-foreground:#64748b] [--border:#e2e8f0] [--input:#cbd5e1]"><section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
    <h1 className="text-2xl font-semibold tracking-tight">{canCreate ? "Set up your business" : "Business setup unavailable"}</h1>
    {canCreate ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">Tell us about your business, then review its details and connect your tools. You choose what your assistants may do.</p><FirstOwnerForm requestKey={randomUUID()} /><p className="mt-5 text-xs leading-5 text-muted-foreground">Creating a workspace does not send customer messages or enable assistants. Review your business and permissions before enabling actions.</p></> : <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">{message}</p>}
    {!canCreate ? <a href="/start" className="mt-5 inline-flex min-h-11 items-center rounded-xl border border-slate-200 px-4 text-sm font-medium text-slate-700">Check again</a> : null}
    <div className="mt-6"><SignOutButton /></div>
    <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-blue-700" href="/preview">Browse workspace preview</Link>
  </section></main>;
}
