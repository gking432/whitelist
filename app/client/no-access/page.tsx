import { LockKeyhole } from "lucide-react";

import { loadClientPortal } from "@/lib/clients/portal";

export const metadata = { title: "Workspace access" };
export const dynamic = "force-dynamic";

export default async function ClientNoAccessPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;

  return (
    <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
      <LockKeyhole
        className="size-6 text-muted-foreground"
        aria-hidden="true"
      />
      <h1 className="mt-3 text-sm font-semibold">
        No workspace sections assigned
      </h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
        Your account is active, but your business owner has not enabled a
        workspace section for your role. Contact them to request access.
      </p>
    </section>
  );
}
