import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DailyBrief } from "@/components/business/daily-brief";
import { loadDailyBrief } from "@/lib/business/daily-brief-data";
import { canReadBusinessWorkspace } from "@/lib/business/access";

import { ClientActionCenter } from "@/components/client/action-center";
import { loadClientPortal } from "@/lib/clients/portal";
import { clientHomePath } from "@/lib/permissions/client-sections";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const portal = await loadClientPortal();

  return {
    title: {
      absolute:
        portal.kind === "ok"
          ? `Today | ${portal.client.name}`
          : "Action Center",
    },
  };
}

export default async function ClientPortalPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }

  if (canReadBusinessWorkspace(portal.access)) {
    return <DailyBrief data={await loadDailyBrief(portal)} />;
  }

  if (portal.access.canViewActionCenter) {
    return <ClientActionCenter />;
  }

  if (portal.client.client_experience_mode === "northstar_crm") {
    redirect(
      clientHomePath(
        portal.access.visibleClientSections,
        portal.client.client_experience_mode,
      ),
    );
  }

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
