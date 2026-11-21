import { randomUUID } from "node:crypto";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { loadFirstOwnerEntry, type FirstOwnerEntry } from "@/lib/auth/first-owner";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { FirstOwnerForm } from "./first-owner-form";
import { SignOutButton } from "@/components/auth/sign-out-button";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Set up your business" } };
export default async function FirstOwnerStartPage() {
  const { user } = await getAuthState();
  if (!user) redirect("/login?next=%2Fstart");
  const supabase = await createSupabaseServerClient();
  let message = "Business setup is unavailable. Try again shortly.", canCreate = false;
  let entry: FirstOwnerEntry | null = null;
  if (supabase) {
    try { entry = await loadFirstOwnerEntry(supabase); } catch { /* Access checks fail closed. */ }
  }
  if (entry?.state === "existing") redirect(entry.destination);
  if (entry?.state === "new") canCreate = true;
  else if (entry?.state === "blocked" || entry?.state === "setup_required") message = entry.reason;
  return <main className="min-h-screen bg-background px-6 py-12"><section className="mx-auto w-full max-w-xl rounded-2xl border bg-card p-6 sm:p-8">
    <h1 className="text-2xl font-semibold tracking-tight">{canCreate ? "Set up your business" : "Business setup unavailable"}</h1>
    {canCreate ? <><p className="mt-3 text-sm leading-6 text-muted-foreground">Tell us about your business, then review its details and connect your tools. You choose what your assistants may do.</p><FirstOwnerForm requestKey={randomUUID()} /><p className="mt-5 text-xs leading-5 text-muted-foreground">Creating a workspace does not send customer messages or enable assistants. Review your business and permissions before enabling actions.</p></> : <p className="mt-3 text-sm leading-6 text-muted-foreground" role="status">{message}</p>}
    <div className="mt-6"><SignOutButton /></div>
    <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-medium text-primary" href="/">Back to home</Link>
  </section></main>;
}
