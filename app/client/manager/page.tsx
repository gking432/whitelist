import { redirect } from "next/navigation";
import { BusinessManagerChat } from "@/components/agents/manager-chat";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readManagerChat } from "@/lib/agents/manager-chat";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Agents" } };

export default async function BusinessManagerPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p className="p-6">The data service is unavailable.</p>;
  return (
    <BusinessManagerChat
      initialSnapshot={await readManagerChat(
        admin,
        { partnerId: portal.client.partner_id, clientId: portal.client.id },
        canWriteBusinessWorkspace(portal.access),
      )}
    />
  );
}
