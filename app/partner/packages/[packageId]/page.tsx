import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { updatePackage } from "@/app/partner/packages/actions";
import { AppShell } from "@/components/layout/app-shell";
import { PackageForm } from "@/components/partner/package-form";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { enabledCapabilityKeys } from "@/lib/packages/capabilities";
import type { PartnerPackageRecord } from "@/lib/packages/requirements";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Edit Package",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ packageId: string }>;
};

export default async function EditPackagePage({ params }: PageProps) {
  const { packageId } = await params;
  const user = await requireAuthenticatedUser("/partner/packages");

  let partnerId: string | undefined;

  try {
    const access = await requirePrimaryPartnerAccess(user.id);
    partnerId = access.partnerId;
  } catch (error) {
    if (isAccessError(error)) {
      return null;
    }

    throw error;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase || !partnerId) {
    return null;
  }

  const { data } = await supabase
    .from("partner_packages")
    .select("*")
    .eq("id", packageId)
    .eq("partner_id", partnerId)
    .maybeSingle();

  const pkg = data as PartnerPackageRecord | null;

  if (!pkg) {
    return (
      <AppShell
        organizationName="Partner workspace"
        userEmail={user.email ?? ""}
        activeNav="packages"
      >
        <section className="rounded-lg border bg-card p-6">
          <h1 className="font-semibold">Package not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            <Link href="/partner/packages" className="underline">
              Back to packages
            </Link>
          </p>
        </section>
      </AppShell>
    );
  }

  const boundUpdate = updatePackage.bind(null, pkg.id);

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? ""}
      activeNav="packages"
    >
      <div className="space-y-5">
        <div>
          <Link
            href="/partner/packages"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to packages
          </Link>
          <h1 className="mt-2 text-xl font-semibold">Edit {pkg.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Changes apply to future setup checklists. Workflows already
            enabled for clients on this package are not changed automatically.
          </p>
        </div>
        <section className="rounded-lg border bg-card p-6">
          <PackageForm
            action={boundUpdate}
            submitLabel="Save package"
            initialName={pkg.name}
            initialDescription={pkg.description ?? ""}
            initialCapabilities={enabledCapabilityKeys(pkg.capabilities)}
          />
        </section>
      </div>
    </AppShell>
  );
}
