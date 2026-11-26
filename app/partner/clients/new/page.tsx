import Link from "next/link";
import { ArrowLeft, Package } from "lucide-react";

import { createClientBusiness } from "@/app/partner/clients/actions";
import { AppShell } from "@/components/layout/app-shell";
import {
  ClientOnboardingForm,
  type ClientOnboardingPackage,
} from "@/components/partner/client-onboarding-form";
import { StarterPackagesButton } from "@/components/partner/package-buttons";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  CAPABILITIES,
  STAFF_RUNTIME_LABELS,
  enabledCapabilityKeys,
} from "@/lib/packages/capabilities";
import {
  requirementsForPackage,
  type PartnerPackageRecord,
} from "@/lib/packages/requirements";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Add Client",
};

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const user = await requireAuthenticatedUser("/partner/clients/new");
  let partnerId: string | null = null;

  try {
    const access = await requirePrimaryPartnerAccess(
      user.id,
      PARTNER_MANAGER_ROLES,
    );
    partnerId = access.partnerId ?? null;
  } catch (error) {
    if (isAccessError(error)) {
      return (
        <main className="flex min-h-screen items-center justify-center px-6 py-10">
          <div className="w-full max-w-lg rounded-lg border bg-card p-6">
            <h1 className="text-lg font-semibold">
              Partner owner or admin access required
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Creating client businesses requires a partner owner or admin
              role.
            </p>
            <Button asChild variant="outline" className="mt-4">
              <Link href="/partner/clients">Back to clients</Link>
            </Button>
          </div>
        </main>
      );
    }

    throw error;
  }

  const supabase = await createSupabaseServerClient();
  const { data: packagesData } =
    supabase && partnerId
      ? await supabase
          .from("partner_packages")
          .select("*")
          .eq("partner_id", partnerId)
          .eq("is_archived", false)
          .is("client_id", null)
          .order("created_at", { ascending: true })
      : { data: [] };
  const packages = (packagesData ?? []) as PartnerPackageRecord[];
  const onboardingPackages: ClientOnboardingPackage[] = packages.map((pkg) => {
    const requirements = requirementsForPackage(pkg);

    return {
      id: pkg.id,
      name: pkg.name,
      description: pkg.description,
      capabilities: enabledCapabilityKeys(pkg.capabilities).map((key) => ({
        key,
        label: CAPABILITIES[key].label,
      })),
      requirements: requirements.integrations.map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        purpose: requirement.purpose,
        recommended: requirement.recommended,
      })),
      staffRuntimes: requirements.staffRuntimes.map((runtime) => ({
        runtime,
        ...STAFF_RUNTIME_LABELS[runtime],
      })),
    };
  });

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? "Authenticated user"}
      activeNav="clients"
    >
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <Button asChild variant="ghost" className="px-0">
            <Link href="/partner/clients">
              <ArrowLeft aria-hidden="true" />
              Clients
            </Link>
          </Button>
          <h1 className="mt-2 text-2xl font-semibold">Onboard a client</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Turn the sold package into a sandbox workspace and a concrete
            setup plan.
          </p>
        </div>

        {onboardingPackages.length > 0 ? (
          <ClientOnboardingForm
            action={createClientBusiness}
            packages={onboardingPackages}
          />
        ) : (
          <section className="rounded-lg border bg-card px-6 py-10 text-center">
            <Package className="mx-auto size-6 text-primary" aria-hidden="true" />
            <h2 className="mt-3 font-semibold">Create a package first</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
              Every client starts with the offer they purchased. Create the
              starter packages or build your own, then return here.
            </p>
            <div className="mt-5 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <StarterPackagesButton />
              <Button asChild variant="outline">
                <Link href="/partner/packages/new">Build a custom package</Link>
              </Button>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
