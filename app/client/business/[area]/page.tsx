import { notFound, redirect } from "next/navigation";
import { BusinessWorkspace } from "@/components/business/workspace";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { loadBusinessSnapshot } from "@/lib/business/data";
import { BUSINESS_AREAS, type BusinessArea } from "@/lib/business/types";
export const dynamic = "force-dynamic";
export const metadata = { title: "Your business" };
export default async function BusinessAreaPage({
  params,
  searchParams,
}: {
  params: Promise<{ area: string }>;
  searchParams: Promise<{ record?: string; search?: string }>;
}) {
  const [{ area }, query] = await Promise.all([params, searchParams]);
  if (!BUSINESS_AREAS.includes(area as BusinessArea)) notFound();
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const search = area === "customers" && typeof query.search === "string" ? query.search.trim().slice(0, 120) : "";
  return (
    <BusinessWorkspace
      key={JSON.stringify([area, search])}
      area={area as BusinessArea}
      initialRecordId={query.record}
      initialSearch={search}
      initialSnapshot={await loadBusinessSnapshot(portal)}
    />
  );
}
