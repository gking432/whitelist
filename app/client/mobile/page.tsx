import { redirect } from "next/navigation";
import type { Viewport } from "next";
import { MobileOwnerView } from "@/components/business/mobile-owner-view";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { loadMobileBusinessData } from "@/lib/business/mobile-data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Needs you" };
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function MobileOwnerPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  return (
    <MobileOwnerView
      data={await loadMobileBusinessData(portal)}
      clientName={portal.client.name}
      timeZone={portal.client.timezone}
      branding={portal.branding}
      isTestAccount={portal.client.is_test_account}
    />
  );
}
