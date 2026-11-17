import { redirect } from "next/navigation";
import { AgentTeam } from "@/components/agents/team";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { readTeam } from "@/lib/agents/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export const metadata = { title: "Agent team" };
export default async function TeamPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p className="p-6">The data service is unavailable.</p>;
  const snapshot = await readTeam(
    admin,
    { partnerId: portal.client.partner_id, clientId: portal.client.id },
    canWriteBusinessWorkspace(portal.access),
  );
  return (
    <AgentTeam initialSnapshot={snapshot} clientName={portal.client.name} />
  );
}
