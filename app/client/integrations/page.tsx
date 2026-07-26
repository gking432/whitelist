import { redirect } from "next/navigation";

import { loadClientPortal } from "@/lib/clients/portal";
import { clientHomePath } from "@/lib/permissions/client-sections";

export const dynamic = "force-dynamic";

export default async function ClientPortalIntegrationsPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") return null;

  redirect(
    clientHomePath(
      portal.access.visibleClientSections,
      portal.client.client_experience_mode,
    ),
  );
}
