import Link from "next/link";
import { Layers3, Package, Plus, UsersRound } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import {
  ArchivePackageButton,
  StarterPackagesButton,
} from "@/components/partner/package-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  CAPABILITIES,
  enabledCapabilityKeys,
} from "@/lib/packages/capabilities";
import type { PartnerPackageRecord } from "@/lib/packages/requirements";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Packages",
};

export const dynamic = "force-dynamic";

function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Partner access required</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Package management is available to active partner members only.
        </p>
      </div>
    </main>
  );
}

export default async function PackagesPage() {
  const user = await requireAuthenticatedUser("/partner/packages");

  let access: AccessContext;

  try {
    access = await requirePrimaryPartnerAccess(user.id);
  } catch (error) {
    if (isAccessError(error)) {
      return <AccessDenied />;
    }

    throw error;
  }

  if (!access.partnerId) {
    return <AccessDenied />;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <AccessDenied />;
  }

  const [{ data: packagesData }, { data: clientRows }] = await Promise.all([
    supabase
      .from("partner_packages")
      .select("*")
      .eq("partner_id", access.partnerId)
      .eq("is_archived", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("client_businesses")
      .select("package_id")
      .eq("partner_id", access.partnerId)
      .not("package_id", "is", null),
  ]);

  const packages = (packagesData ?? []) as PartnerPackageRecord[];
  const clientCounts = new Map<string, number>();

  for (const row of clientRows ?? []) {
    if (row.package_id) {
      clientCounts.set(
        row.package_id,
        (clientCounts.get(row.package_id) ?? 0) + 1,
      );
    }
  }

  const reusablePackages = packages.filter((pkg) => !pkg.client_id);
  const customPackages = packages.filter((pkg) => pkg.client_id);

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? ""}
      activeNav="packages"
    >
      <div className="space-y-5">
        <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase text-muted-foreground">
              What you sell
            </p>
            <h1 className="text-xl font-semibold">Packages</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Build reusable offers, assign one during client onboarding, and
              get the exact setup and testing checklist for that sale.
            </p>
          </div>
          <Button asChild>
            <Link href="/partner/packages/new">
              <Plus aria-hidden="true" />
              New package
            </Link>
          </Button>
        </header>

        <section
          aria-label="Package catalog summary"
          className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-3"
        >
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <Layers3 className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 text-2xl font-semibold">
              {reusablePackages.length}
            </p>
            <p className="text-xs text-muted-foreground">Reusable offers</p>
          </div>
          <div className="border-b p-4 sm:border-b-0 sm:border-r">
            <UsersRound className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 text-2xl font-semibold">
              {clientRows?.length ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Assigned clients</p>
          </div>
          <div className="p-4">
            <Package className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-2 text-2xl font-semibold">
              {customPackages.length}
            </p>
            <p className="text-xs text-muted-foreground">Client-only offers</p>
          </div>
        </section>

        {reusablePackages.length === 0 ? (
          <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border bg-card px-6 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Package className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-semibold">No packages yet</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Start with the three common tiers — Basic Automation, AI Assist,
              and Full AI Operations — then rename or retoggle them to match
              what you actually sell.
            </p>
            <div className="mt-5">
              <StarterPackagesButton />
            </div>
          </section>
        ) : (
          <section aria-labelledby="reusable-packages-heading">
            <div className="mb-3">
              <h2 id="reusable-packages-heading" className="font-semibold">
                Reusable offers
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Select one of these when onboarding a new client.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {reusablePackages.map((pkg) => {
                const capabilityKeys = enabledCapabilityKeys(pkg.capabilities);
                const clientCount = clientCounts.get(pkg.id) ?? 0;

                return (
                  <article
                    key={pkg.id}
                    className="rounded-lg border bg-card p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/partner/packages/${pkg.id}`}
                          className="font-semibold hover:underline"
                        >
                          {pkg.name}
                        </Link>
                        <p className="mt-1 text-sm leading-5 text-muted-foreground">
                          {pkg.description ?? "No description."}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {clientCount} client{clientCount === 1 ? "" : "s"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {capabilityKeys.length === 0 ? (
                        <span className="text-xs text-muted-foreground">
                          Nothing toggled on yet.
                        </span>
                      ) : (
                        capabilityKeys.map((key) => (
                          <Badge key={key} variant="outline">
                            {CAPABILITIES[key].label}
                          </Badge>
                        ))
                      )}
                    </div>
                    <div className="mt-4 flex items-center justify-between border-t pt-3">
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/partner/packages/${pkg.id}`}>Edit</Link>
                      </Button>
                      <ArchivePackageButton packageId={pkg.id} />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {reusablePackages.length > 0 && reusablePackages.length < 3 ? (
          <StarterPackagesButton />
        ) : null}

        {customPackages.length > 0 ? (
          <section className="rounded-lg border bg-card p-5">
            <h2 className="text-sm font-semibold">
              Custom one-off packages ({customPackages.length})
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Created for a single client during setup. Manage them from that
              client&apos;s Setup tab.
            </p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {customPackages.map((pkg) => (
                <li key={pkg.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{pkg.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {enabledCapabilityKeys(pkg.capabilities)
                      .map((key) => CAPABILITIES[key].label)
                      .join(", ") || "No capabilities toggled."}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
