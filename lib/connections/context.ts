import { getAuthState } from "@/lib/auth/session";
import { loadClientPortal } from "@/lib/clients/portal";
import { notifyContextFailure, type ContextDiagnostic, type ContextDiagnosticObserver, type ContextDiagnosticStage } from "@/lib/auth/context-diagnostics";
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

export type ConnectionsContext = NonNullable<Awaited<ReturnType<typeof connectionsContext>>>;
export type ConnectionsContextDecision =
  | { kind: "ok"; context: ConnectionsContext }
  | { kind: "denied" | "unavailable"; diagnostic: ContextDiagnostic };

/** Detailed opt-in boundary for callers that distinguish unavailable lookups
 * from denied access. The legacy resolver above retains its existing contract. */
export async function connectionsContextDecision(write = false): Promise<ConnectionsContextDecision> {
  let first: ContextDiagnostic | undefined;
  const observe: ContextDiagnosticObserver = (event) => { first ??= event; };
  const failed = (stage: ContextDiagnosticStage, kind: ContextDiagnostic["kind"], error?: unknown): ConnectionsContextDecision => {
    const diagnostic = first ?? notifyContextFailure(observe, stage, kind, error);
    return { kind: diagnostic.kind, diagnostic };
  };
  let stage: ContextDiagnosticStage = "auth_user";
  try {
    const auth = await getAuthState(observe);
    if (!auth.user) return failed(auth.isSupabaseConfigured ? "auth_user" : "configuration", auth.isSupabaseConfigured ? "denied" : "unavailable");
    stage = "portal_access";
    const portal = await loadClientPortal(observe);
    if (portal.kind !== "ok") return failed("portal_access", portal.kind === "unavailable" ? "unavailable" : "denied");
    if (portal.user.id !== auth.user.id) return failed("portal_access", "denied");
    if (!canReadBusinessWorkspace(portal.access)) return failed("workspace_sections", "denied");
    if (write && portal.access.isImpersonating) return failed("impersonation", "denied");
    if (write && !canWriteBusinessWorkspace(portal.access)) return failed("workspace_sections", "denied");
    return { kind: "ok", context: { portal, user: auth.user, scope: { partnerId: portal.client.partner_id, clientId: portal.client.id } } };
  } catch (error) {
    return failed(stage, "unavailable", error);
  }
}
