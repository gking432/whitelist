import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loadFirstOwnerEntry } from "@/lib/auth/first-owner";
import { canReadBusinessWorkspace } from "@/lib/business/access";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { PortalShell } from "@/components/client/portal-shell";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { loadClientPortal } from "@/lib/clients/portal";
import { loadUnreadNotificationCount } from "@/lib/notifications/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isLocalDevAutoLoginEnabled } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const portal = await loadClientPortal();
  const productName =
    portal.kind === "ok"
      ? portal.branding.productName.replaceAll("%", "").trim() || "CRM"
      : "Client Portal";

  return {
    title: {
      default: productName,
      template: `%s | ${productName}`,
    },
  };
}

export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const portal = await loadClientPortal();

  if (portal.kind === "denied") {
    const entryClient = await createSupabaseServerClient();
    let destination: string | null = null;
    if (entryClient) {
      try {
        const entry = await loadFirstOwnerEntry(entryClient);
        if (entry.state === "new" || entry.state === "setup_required" || entry.state === "blocked") destination = "/start";
        else if (entry.state === "existing" && entry.destination !== "/client") destination = entry.destination;
      } catch { /* A failed eligibility check never grants setup access. */ }
    }
    if (destination) redirect(destination);
    const localPreview =
      process.env.NODE_ENV !== "production" && isLocalDevAutoLoginEnabled();
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">
            {localPreview
              ? "Select a business to preview"
              : "Portal access unavailable"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {localPreview
              ? "This browser does not have an active business selected. Choose your business from the account directory."
              : "Your account does not have access to this workspace. Ask its administrator to check your access."}
          </p>
          <div className="mt-5"><SignOutButton /></div>
          {localPreview ? (
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                href="/workspaces/client"
                className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Choose a business
              </Link>
              <Link
                href="/control/activation"
                className="inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium"
              >
                Set up a business
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  if (portal.kind === "unavailable") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">Portal unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The portal could not be loaded. Try again shortly.
          </p>
          <div className="mt-5"><SignOutButton /></div>
        </div>
      </main>
    );
  }

  const supabase = await createSupabaseServerClient();
  const unreadNotificationCount =
    supabase &&
    portal.access.clientId &&
    portal.access.visibleClientSections.includes("notifications")
      ? await loadUnreadNotificationCount(
          supabase,
          portal.access.clientId,
          portal.user.id,
        )
      : 0;

  return (
    <PortalShell
      accountActions={<SignOutButton />}
      businessWorkspace={canReadBusinessWorkspace(portal.access)}
      clientName={portal.client.name}
      branding={portal.branding}
      experienceMode={portal.client.client_experience_mode}
      userEmail={portal.user.email ?? "Signed in"}
      visibleSections={portal.access.visibleClientSections}
      unreadNotificationCount={unreadNotificationCount}
      banner={<ImpersonationBanner />}
      canManageConnections={
        !portal.access.isImpersonating &&
        ["client_owner", "client_manager"].includes(portal.access.role) &&
        portal.access.canOperateCustomerActions &&
        portal.access.visibleClientSections.includes("settings")
      }
      canReviewLaunch={
        portal.access.role === "client_owner" && !portal.access.isImpersonating
      }
    >
      {children}
    </PortalShell>
  );
}
