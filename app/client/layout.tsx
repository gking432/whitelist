import { PortalShell } from "@/components/client/portal-shell";
import { ImpersonationBanner } from "@/components/impersonation/impersonation-banner";
import { loadClientPortal } from "@/lib/clients/portal";
import { loadUnreadNotificationCount } from "@/lib/notifications/client";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Client Portal",
};

export default async function ClientPortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const portal = await loadClientPortal();

  if (portal.kind === "denied") {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 py-10">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">Portal access unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Your account is not connected to an active client portal. Contact
            the partner that manages your business&apos;s automations to
            request access.
          </p>
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
      clientName={portal.client.name}
      branding={portal.branding}
      experienceMode={portal.client.client_experience_mode}
      userEmail={portal.user.email ?? "Signed in"}
      visibleSections={portal.access.visibleClientSections}
      unreadNotificationCount={unreadNotificationCount}
      banner={<ImpersonationBanner />}
    >
      {children}
    </PortalShell>
  );
}
