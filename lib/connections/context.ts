import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import {
  canReadBusinessWorkspace,
  canWriteBusinessWorkspace,
} from "@/lib/business/access";
export async function connectionsContext(write = false) {
  const { user } = await getAuthState();
  if (!user) return null;
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !canReadBusinessWorkspace(portal.access))
    return null;
  if (
    write &&
    (!canWriteBusinessWorkspace(portal.access) || portal.access.isImpersonating)
  )
    return null;
  return {
    portal,
    user,
    scope: { partnerId: portal.client.partner_id, clientId: portal.client.id },
  };
}
