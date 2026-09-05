import { LiveCallOverlay } from "@/components/assistant/live-call-overlay";
import { loadClientPortal } from "@/lib/clients/portal";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Phone Assistant",
};

export default async function DesktopAssistantPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="max-w-sm text-center">
          <h1 className="text-sm font-semibold">Sign in required</h1>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Sign in to the client workspace in this window. The phone assistant
            will then come forward automatically when a connected call begins.
          </p>
          <a
            href="/login?next=/desktop/assistant"
            className="mt-4 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground"
          >
            Sign in
          </a>
        </div>
      </main>
    );
  }

  if (!portal.access.visibleClientSections.includes("assistant")) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <p className="text-sm text-muted-foreground">
          Phone assistant access is not enabled for this account.
        </p>
      </main>
    );
  }

  return (
    <LiveCallOverlay standalone productName={portal.branding.productName} />
  );
}
