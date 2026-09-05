import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { StarterPackagesButton } from "@/components/partner/package-buttons";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { agencyLaunchSteps } from "@/lib/partners/launch-guide";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch your agency" };

export default async function AgencyStartPage() {
  const user = await requireAuthenticatedUser("/partner/start");
  const access = await requirePrimaryPartnerAccess(user.id);
  const db = await createSupabaseServerClient();
  if (!db || !access.partnerId) return null;
  const [branding, packages, clients, partner] = await Promise.all([
    db
      .from("partner_branding")
      .select("product_name,logo_url")
      .eq("partner_id", access.partnerId)
      .maybeSingle(),
    db
      .from("partner_packages")
      .select("id")
      .eq("partner_id", access.partnerId)
      .eq("is_archived", false)
      .is("client_id", null),
    db
      .from("client_businesses")
      .select("id,name,default_runtime_mode")
      .eq("partner_id", access.partnerId)
      .eq("account_kind", "managed_client")
      .neq("status", "archived")
      .order("created_at")
      .limit(1)
      .maybeSingle(),
    db.from("partners").select("name").eq("id", access.partnerId).single(),
  ]);
  if (branding.error || packages.error || clients.error || partner.error)
    return (
      <p role="alert">
        Your agency setup could not be loaded. Refresh to try again.
      </p>
    );
  const steps = agencyLaunchSteps({
    branded: Boolean(branding.data?.product_name && branding.data?.logo_url),
    packageCount: packages.data?.length ?? 0,
    firstClient: clients.data
      ? {
          id: clients.data.id,
          name: clients.data.name,
          live: clients.data.default_runtime_mode === "live",
        }
      : null,
  });
  const next = steps.find((step) => !step.done);
  return (
    <AppShell
      organizationName={partner.data.name}
      userEmail={user.email ?? ""}
      activeNav="start"
    >
      <div className="mx-auto max-w-4xl space-y-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            Your agency launch guide
          </p>
          <h1 className="mt-3 text-3xl font-semibold">
            Build your offer. Make it yours.
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">
            You bring the client relationship. This workspace guides you through
            branding, packaging and implementation—one client at a time.
          </p>
        </header>
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-6">
          <p className="text-sm text-muted-foreground">
            {steps.filter((step) => step.done).length} of {steps.length} steps
            complete
          </p>
          <h2 className="mt-2 text-xl font-semibold">
            {next?.title ?? "Your agency is underway"}
          </h2>
          <p className="mt-2 text-sm leading-6">
            {next?.detail ??
              "Keep an eye on client health and use the same setup path for your next client."}
          </p>
          <Button asChild className="mt-5">
            <Link href={next?.href ?? "/partner"}>
              {next?.action ?? "Open agency overview"}
            </Link>
          </Button>
        </section>
        <ol className="grid gap-4 sm:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step.title} className="rounded-xl border bg-card p-6">
              <p className="text-xs font-semibold text-primary">
                {step.done ? "Complete" : `Step ${index + 1}`}
              </p>
              <h2 className="mt-2 font-semibold">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.detail}
              </p>
              <Link
                className="mt-4 inline-block text-sm font-medium underline underline-offset-4"
                href={step.href}
              >
                {step.done ? "Review" : step.action}
              </Link>
            </li>
          ))}
        </ol>
        {!packages.data?.length && access.role !== "partner_viewer" ? (
          <section className="rounded-xl border p-6">
            <h2 className="font-semibold">Start with ready-made offers</h2>
            <p className="mb-4 mt-2 text-sm leading-6 text-muted-foreground">
              Add the starter packages, rename them for your agency and choose
              the capabilities you want to sell.
            </p>
            <StarterPackagesButton />
          </section>
        ) : null}
        <section className="rounded-xl border p-6">
          <h2 className="font-semibold">Who does what?</h2>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            You sell the service, configure the workflow and help your client
            launch. The business connects its accounts, chooses employee
            permissions and approves customer messages. Platform support handles
            infrastructure and escalated problems.
          </p>
          <Link
            href="/partner/support"
            className="mt-4 inline-block text-sm underline"
          >
            Get implementation help
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
