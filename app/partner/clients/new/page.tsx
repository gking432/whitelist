import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { createClientBusiness } from "@/app/partner/clients/actions";
import { AppShell } from "@/components/layout/app-shell";
import { ClientBusinessForm } from "@/components/partner/client-business-form";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";

export const metadata = {
  title: "Add Client",
};

export const dynamic = "force-dynamic";

export default async function NewClientPage() {
  const user = await requireAuthenticatedUser("/partner/clients/new");

  try {
    await requirePrimaryPartnerAccess(user.id, PARTNER_MANAGER_ROLES);
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

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? "Authenticated user"}
      activeNav="clients"
    >
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Button asChild variant="ghost" className="px-0">
            <Link href="/partner/clients">
              <ArrowLeft aria-hidden="true" />
              Clients
            </Link>
          </Button>
          <h1 className="mt-2 text-2xl font-semibold">Add client business</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Create the client record first. Integrations and workflows are
            configured from the client workspace afterward.
          </p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <ClientBusinessForm
            action={createClientBusiness}
            submitLabel="Create client"
          />
        </div>
      </div>
    </AppShell>
  );
}
