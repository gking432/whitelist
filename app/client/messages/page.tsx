import { ConnectedDataRefresh } from "@/components/business/connected-data-refresh";
import { redirect } from "next/navigation";
import { z } from "zod";
import { readConnectedData } from "@/lib/connections/data";
import { SyncedMessages } from "@/components/business/synced-messages";
import { ConnectedIntakeRecords } from "@/components/business/connected-intake";
import { ConversationInbox } from "@/components/conversations/inbox";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readConversations } from "@/lib/conversations/store";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Messages" } };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p role="alert">The data service is unavailable.</p>;
  const { id } = await searchParams;
  const scope = { partnerId: portal.client.partner_id, clientId: portal.client.id };
  const [connected, conversations] = await Promise.all([
    readConnectedData(admin, scope),
    readConversations(admin, scope, canWriteBusinessWorkspace(portal.access), z.uuid().safeParse(id).success ? id : undefined),
  ]);
  return (
    <>
      <ConnectedDataRefresh />
      <SyncedMessages data={connected} timeZone={portal.client.timezone} />
      <ConnectedIntakeRecords data={connected} timeZone={portal.client.timezone} canAdopt={canWriteBusinessWorkspace(portal.access) && !portal.access.isImpersonating} />
      {conversations.conversations.length ? (
        <ConversationInbox
          initialSnapshot={conversations}
          timeZone={portal.client.timezone}
        />
      ) : null}
    </>
  );
}
