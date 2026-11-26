import { redirect } from "next/navigation";
import { ActivationSetup } from "@/components/business/activation-setup";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { readActivation } from "@/lib/activation/service";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Connect your assistants" };
export default async function ActivationPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p className="p-6">The data service is unavailable.</p>;
  const snapshot = await readActivation(
    admin,
    { partnerId: portal.client.partner_id, clientId: portal.client.id },
    canWriteBusinessWorkspace(portal.access),
  );
  return (
    <ActivationSetup
      initialSnapshot={snapshot}
      outcome={(await searchParams).connection}
    />
  );
}
