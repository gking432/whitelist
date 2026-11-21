import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createPackage } from "@/app/partner/packages/actions";
import { AppShell } from "@/components/layout/app-shell";
import { PackageForm } from "@/components/partner/package-form";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";

export const metadata = {
  title: "New Package",
};

export const dynamic = "force-dynamic";

export default async function NewPackagePage() {
  const user = await requireAuthenticatedUser("/partner/packages/new");

  try {
    await requirePrimaryPartnerAccess(user.id, PARTNER_OPERATOR_ROLES);
  } catch (error) {
    if (isAccessError(error)) {
      return null;
    }

    throw error;
  }

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
          <h1 className="mt-2 text-xl font-semibold">New package</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define a reusable offer. You&apos;ll pick it during client setup
            and Northstar will turn it into a concrete checklist.
          </p>
        </div>
        <section className="rounded-lg border bg-card p-6">
          <PackageForm action={createPackage} submitLabel="Create package" />
        </section>
      </div>
    </AppShell>
  );
}
