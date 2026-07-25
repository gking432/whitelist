import { redirect } from "next/navigation";

import { ClientActionCenter } from "@/components/client/action-center";
import { loadClientPortal } from "@/lib/clients/portal";
import { clientHomePath } from "@/lib/permissions/client-sections";

export const metadata = { title: "Action Center" };
export const dynamic = "force-dynamic";

export default async function ClientActionCenterPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") return null;
  if (!portal.access.canViewActionCenter) {
    redirect(
      clientHomePath(
        portal.access.visibleClientSections,
        portal.client.client_experience_mode,
      ),
    );
  }

  return <ClientActionCenter />;
}
