import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ArrowLeft, PhoneCall, CalendarClock, Workflow } from "lucide-react";

import { publicAgencyBrand } from "@/lib/partners/public-brand";
import { LoginForm } from "@/app/login/login-form";
import { Button } from "@/components/ui/button";
import { getAuthState } from "@/lib/auth/session";
import { toSafeNextPath } from "@/lib/auth/redirects";
import { isLocalDevAutoLoginEnabled } from "@/lib/env";

type LoginPageProps = {
  searchParams: Promise<{
    next?: string;
    error?: string;
    agency?: string;
  }>;
};

export async function generateMetadata({ searchParams }: LoginPageProps) {
  const brand = await publicAgencyBrand((await searchParams).agency);
  return {
    title: { absolute: `Sign in | ${brand?.name ?? "Business workspace"}` },
  };
}

export const dynamic = "force-dynamic";

const pillars = [
  {
    icon: PhoneCall,
    label: "AI voice",
    detail: "Help answer calls and follow up with new leads.",
  },
  {
    icon: CalendarClock,
    label: "AI scheduling",
    detail: "Book real slots against real calendars.",
  },
  {
    icon: Workflow,
    label: "AI workflows",
    detail: "Automate routine tasks and review customer actions.",
  },
];

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const brand = await publicAgencyBrand(params.agency);
  const nextPath = toSafeNextPath(params.next, "/");
  const authState = await getAuthState();

  if (authState.user) {
    redirect(nextPath);
  }

  const devLoginEnabled = isLocalDevAutoLoginEnabled();

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden flex-col justify-between overflow-hidden bg-brand-deep p-10 text-white lg:flex">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(60rem 40rem at 85% -10%, rgba(199,154,59,0.14), transparent 60%), radial-gradient(50rem 36rem at -10% 110%, rgba(44,106,79,0.5), transparent 60%)",
          }}
        />
        <div className="relative">
          <span className="flex items-center gap-3 text-lg font-semibold">
            {brand?.logoUrl ? (
              <Image
                src={brand.logoUrl}
                alt=""
                width={40}
                height={40}
                unoptimized
                className="size-10 rounded object-contain"
              />
            ) : null}
            {brand?.name ?? "Business workspace"}
          </span>
        </div>

        <div className="relative max-w-md">
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">
            Less busywork. More time for your customers.
          </h1>
          <p className="mt-4 text-sm leading-6 text-white/60">
            Manage your customers and connected tools in one place. Your
            business reviews customer messages and booking requests before
            delivery.
          </p>

          <ul className="mt-8 space-y-4">
            {pillars.map((pillar) => {
              const Icon = pillar.icon;

              return (
                <li key={pillar.label} className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/8 text-brand-gold">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-sm font-medium">
                      {pillar.label}
                    </span>
                    <span className="block text-[13px] leading-5 text-white/55">
                      {pillar.detail}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <p className="relative text-[11px] text-white/35">
          Secure access to your business workspace.
        </p>
      </section>

      {/* Form panel */}
      <section className="flex items-center justify-center px-6 py-12">
        <div className="ns-fade-up w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="flex items-center gap-3 text-lg font-semibold">
              {brand?.logoUrl ? (
                <Image
                  src={brand.logoUrl}
                  alt=""
                  width={40}
                  height={40}
                  unoptimized
                  className="size-10 rounded object-contain"
                />
              ) : null}
              {brand?.name ?? "Business workspace"}
            </span>
          </div>

          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-6 px-2">
            <Link href="/">
              <ArrowLeft aria-hidden="true" />
              Back
            </Link>
          </Button>

          <h2 className="text-2xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Enter your work email. We&apos;ll send you a secure sign-in link.
          </p>

          <div className="mt-8">
            <LoginForm
              isSupabaseConfigured={authState.isSupabaseConfigured}
              nextPath={nextPath}
            />
          </div>

          {params.error === "dev-login-failed" ? (
            <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              Local dev sign-in failed. Check that the local Supabase seed has
              been applied.
            </p>
          ) : null}

          {devLoginEnabled ? (
            <div className="mt-8 rounded-xl border border-dashed bg-secondary/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Local development
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/dev/auto-login?next=${encodeURIComponent(nextPath)}`}
                  >
                    Sign in as partner
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dev/auto-login?next=/client">
                    Sign in as client
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/dev/auto-login?next=/control">
                    Sign in as platform owner
                  </Link>
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
