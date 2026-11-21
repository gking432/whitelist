import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { publicAgencyBrand } from "@/lib/partners/public-brand";
import { LoginForm } from "@/app/login/login-form";
import { getAuthState } from "@/lib/auth/session";
import { toSafeNextPath } from "@/lib/auth/redirects";
import { hasPrivateSignInIntent } from "@/lib/auth/public-review-entry";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readOwnerSetupReadiness } from "@/lib/auth/owner-setup-readiness";
import { SetupUnavailable } from "@/components/auth/setup-unavailable";

type LoginPageProps = {
  searchParams: Promise<{ next?: string; error?: string; agency?: string }>;
};

export async function generateMetadata({ searchParams }: LoginPageProps) {
  const brand = await publicAgencyBrand((await searchParams).agency);
  return { title: { absolute: `Sign in | ${brand?.name ?? "Business workspace"}` } };
}

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  // Viewing the workstation never requires this optional private sign-in flow.
  if (!hasPrivateSignInIntent(params)) redirect("/preview");
  const nextPath = toSafeNextPath(params.next, "/start");
  const [brand, authState] = await Promise.all([
    publicAgencyBrand(params.agency), getAuthState(),
  ]);
  if (authState.user) redirect(nextPath);
  if (nextPath === "/start") {
    const readiness = await readOwnerSetupReadiness(createSupabaseAdminClient());
    if (!readiness.available) return <SetupUnavailable message={readiness.message} />;
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6 py-10 text-slate-900 [--primary:#1d4ed8] [--primary-foreground:#ffffff] [--ring:#2563eb] [--background:#f8fafc] [--foreground:#0f172a] [--muted-foreground:#64748b] [--border:#e2e8f0] [--input:#cbd5e1]">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <Link href="/preview" className="mb-7 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to workspace
        </Link>
        <div className="mb-6 flex items-center gap-3 text-sm font-medium text-slate-500">
          {brand?.logoUrl ? <Image src={brand.logoUrl} alt="" width={40} height={40} unoptimized className="size-10 rounded object-contain" /> : null}
          {brand?.name ?? "Business workspace"}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">Sign in to access your private business and connected accounts.</p>
        <div className="mt-7"><LoginForm isSupabaseConfigured={authState.isSupabaseConfigured} nextPath={nextPath} /></div>
        {params.error === "auth-link-invalid" ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">This sign-in link is incomplete or expired. Request a new link.</p> : null}
        {params.error === "dev-login-failed" ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">Sign-in could not be completed. Try again.</p> : null}
      </section>
    </main>
  );
}
