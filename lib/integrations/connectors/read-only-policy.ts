import { googleAccountCanAct } from "../../connections/google-permissions.ts";
/** Imported records never enter generic CRM projection or connector writes. */
export function isWorkspaceViewOnly(config: Record<string, unknown>) {
  return config.workspace_view_only === true || config.hubspot_owner_crm === true;
}

/** The sole owner-import exception is a separately authorized and explicitly
 * activated Google inbox. This does not allow generic CRM/lead projections. */
export function allowsActivatedGoogleInbox(config: Record<string, unknown>, runtimeMode: string, providerKey: string, now = Date.now()): boolean {
  const checked = typeof config.activation_checked_at === "string" ? Date.parse(config.activation_checked_at) : NaN;
  return providerKey === "google_workspace" && isWorkspaceViewOnly(config) && runtimeMode === "live" && config.activation_managed === true &&
    config.conversation_intake_enabled === true && config.activation_mail_verified === true && googleAccountCanAct(config, "email") &&
    Number.isFinite(checked) && checked <= now + 60000 && now - checked < 24 * 60 * 60 * 1000;
}

export function suppressManagedWorkspaceIngress(input: {
  config: Record<string, unknown>; providerKey: string; status: string; runtimeMode: string; eventType: string; teamEnabled: boolean;
}): boolean {
  const ownerImport = isWorkspaceViewOnly(input.config), managed = ownerImport || input.config.activation_managed === true;
  if (!managed) return false;
  if (input.status !== "connected" || input.runtimeMode !== "live" || input.config.conversation_intake_enabled !== true) return true;
  // Collect already-selected incoming customer evidence during a manager/team
  // pause. The durable queue policy separately prevents outgoing assignments.
  return ownerImport ? !collectActivatedGoogleInbox(input) : !input.teamEnabled;
}

export function collectActivatedGoogleInbox(input: {
  config: Record<string, unknown>; providerKey: string; status: string; runtimeMode: string; eventType: string;
}): boolean {
  return input.status === "connected" && input.eventType === "email.received" && allowsActivatedGoogleInbox(input.config, input.runtimeMode, input.providerKey);
}
export function allowsConnectorWork(
  config: Record<string, unknown>,
  direction: string,
  objectType: string,
  providerKey?: string,
) {
  if (providerKey === "hubspot" || config.hubspot_owner_crm === true)
    return config.hubspot_owner_crm === true && config.workspace_view_only === true && direction === "pull" && ["customer", "lead", "note"].includes(objectType);
  return (
    !isWorkspaceViewOnly(config) ||
    (direction === "pull" && ["message", "appointment", "invoice", "payment"].includes(objectType))
  );
}

/** A page continuation is not proof that the authoritative import completed. */
export function connectorCursorIsPartial(cursor: Record<string, unknown> | null): boolean {
  if (cursor?.version === 1 && ["active", "archived"].includes(String(cursor.phase))) return true;
  return !!cursor && ["pageToken", "nextLink", "after"].some((key) =>
    typeof cursor[key] === "string" && String(cursor[key]).length > 0);
}
