import type { ConnectedCrmDeal, ConnectedCustomer, CrmGatewayCommand, CrmGatewayDecisionReceipt, CrmGatewayPin, CrmGatewayReview, HubSpotOwnerPermission } from "./provider-contract.ts";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const nullableText = (value: unknown) => value === null || typeof value === "string";
const timestamp = (value: unknown) => typeof value === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const operations: HubSpotOwnerPermission[] = ["contact.create", "note.create"];
export const CRM_PROPERTY_LIMITS = { firstname: 100, lastname: 100, email: 254, phone: 50, address: 500 } as const;
export const crmSourceRunId = (value: unknown): string | undefined => uuid(value) ? value : undefined;

export function hubspotSetupHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      (url.hostname === "hubspot.com" || url.hostname.endsWith(".hubspot.com")) ? url.href : null;
  } catch { return null; }
}
export function hubspotSourceHref(value: string | null, accountId: string): string | null {
  const safe = hubspotSetupHref(value);
  return safe && /^\d+$/.test(accountId) && new URL(safe).pathname.startsWith(`/contacts/${accountId}/`) ? safe : null;
}
export function crmSourceTime(value: string | null, timeZone: string): string | null {
  if (!value || !timestamp(value)) return null;
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone };
  try { return new Intl.DateTimeFormat("en-US", options).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(value)) + " UTC"; }
}
export function crmDealAmount(amount: string | null, currency: string | null): string {
  if (!amount || amount.length > 100 || !/^-?\d+(?:\.\d+)?$/.test(amount)) return "Amount unavailable";
  return /^[A-Za-z]{3}$/.test(currency || "") ? `${amount} ${currency!.toUpperCase()}` : `${amount} · Currency unavailable`;
}
export function associatedCrmDeals(contact: ConnectedCustomer, deals: ConnectedCrmDeal[]): ConnectedCrmDeal[] {
  return deals.filter((deal) => deal.connectionId === contact.connectionId && deal.accountId === contact.accountId && deal.contactIds.includes(contact.externalId));
}
function isContact(value: unknown, connectionId: string, accountId: string, recordId: string): boolean {
  const contact = object(value);
  return contact.id === recordId && contact.connectionId === connectionId && contact.accountId === accountId && text(contact.externalId) &&
    text(contact.name) && text(contact.account) && text(contact.revision) && typeof contact.archived === "boolean" &&
    [contact.email, contact.phone, contact.lifecycleStage, contact.sourceUpdatedAt, contact.observedAt, contact.href].every(nullableText);
}
export function readCrmGatewayReview(value: unknown, binding: { connectionId: string; recordId?: string; sourceRunId?: string }): CrmGatewayReview {
  const review = object(value), existing = review.existing === null ? null : object(review.existing), run = object(review.sourceRun);
  if (review.version !== 1 || !uuid(binding.connectionId) || review.connectionId !== binding.connectionId || !text(review.accountId) || !text(review.account) || !text(review.revision) ||
      ![review.canWrite, review.selectedCrm, review.actionsEnabled].every((item) => typeof item === "boolean") || !nullableText(review.blockReason) ||
      !Array.isArray(review.permissions) || review.permissions.some((item) => !operations.includes(item)) ||
      (binding.recordId ? !uuid(binding.recordId) || !isContact(review.contact, binding.connectionId, review.accountId as string, binding.recordId) : review.contact !== null) ||
      (binding.sourceRunId ? !uuid(binding.sourceRunId) || run.id !== binding.sourceRunId || ![run.summary, run.eventType, run.templateKey, run.createdAt].every(nullableText) ||
        (typeof run.summary === "string" && run.summary.length > 2000) : review.sourceRun !== undefined) ||
      (existing && (!uuid(existing.approvalId) || !text(existing.status) || !text(existing.detail))))
    throw new Error("The exact HubSpot account and source review could not be confirmed. Refresh before preparing a proposal.");
  return value as CrmGatewayReview;
}
export function crmReviewBlock(review: CrmGatewayReview, operation: HubSpotOwnerPermission): string | null {
  if (!review.canWrite) return "Owner write access is required to prepare this proposal.";
  if (review.blockReason) return review.blockReason;
  if (!review.selectedCrm || !review.actionsEnabled) return "Select this CRM and explicitly enable approved actions in Apps first.";
  if (!review.permissions.includes(operation)) return "The exact HubSpot account has not granted this action permission.";
  if (operation === "note.create" && (!review.contact || review.contact.archived)) return "Choose an available exact source contact before preparing a note.";
  if (operation === "contact.create" && review.contact) return "Open a separate new-customer review; existing contacts are changed in HubSpot.";
  return null;
}
function propertiesForCreate(raw: CrmGatewayPin["properties"] = {}): CrmGatewayPin["properties"] {
  const properties: CrmGatewayPin["properties"] = {};
  for (const key of Object.keys(raw)) if (!(key in CRM_PROPERTY_LIMITS)) throw new Error("Only the reviewed customer fields can be proposed.");
  for (const field of Object.keys(CRM_PROPERTY_LIMITS) as (keyof typeof CRM_PROPERTY_LIMITS)[]) {
    const value = raw[field]?.trim();
    if (!value) continue;
    if (value.length > CRM_PROPERTY_LIMITS[field] || value.includes("\0")) throw new Error(`The ${field} field is too long or contains unsupported text for this review.`);
    properties[field] = value;
  }
  if (![properties.firstname, properties.lastname, properties.email, properties.phone].some(Boolean)) throw new Error("Enter a name, email or phone for the deliberately new HubSpot customer.");
  if (properties.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(properties.email)) throw new Error("Review the email address before preparing this new customer.");
  return properties;
}
export function buildCrmGatewayCommand(review: CrmGatewayReview, operation: HubSpotOwnerPermission, key: string,
  values: { targetConfirmed?: boolean; newIdentityConfirmed?: boolean; note?: string; properties?: CrmGatewayPin["properties"]; sourceRunId?: string }): CrmGatewayCommand {
  const block = crmReviewBlock(review, operation);
  if (block) throw new Error(block);
  if (!operations.includes(operation) || !uuid(key) || !uuid(review.connectionId) || !text(review.revision) || !values.targetConfirmed)
    throw new Error("Explicitly review the exact target and proposed change first.");
  const command: CrmGatewayCommand = { action: "prepare_hubspot_change", key, connectionId: review.connectionId, expectedRevision: review.revision, operation, targetConfirmed: true };
  if (values.sourceRunId !== review.sourceRun?.id) throw new Error("Refresh and read the exact saved work before linking this proposal.");
  if (values.sourceRunId) {
    if (!uuid(values.sourceRunId)) throw new Error("The source work reference is unavailable. Open a current review.");
    command.sourceRunId = values.sourceRunId;
  }
  if (operation === "note.create") {
    const note = values.note?.trim() || "";
    if (!note || note.length > 4000 || note.includes("\0") || !review.contact) throw new Error("Review a note of 1 to 4,000 characters for this exact contact.");
    return { ...command, recordId: review.contact.id, expectedSourceRevision: review.contact.revision, note };
  }
  if (!values.newIdentityConfirmed) throw new Error("Explicitly confirm this is a deliberately new customer, after checking HubSpot for duplicates.");
  return { ...command, properties: propertiesForCreate(values.properties), newIdentityConfirmed: true };
}
export function readCrmGatewayReceipt(value: unknown, connectionId: string): CrmGatewayDecisionReceipt {
  const receipt = object(value);
  if (!uuid(receipt.id) || !uuid(receipt.approvalId) || receipt.connectionId !== connectionId || !text(receipt.message) || typeof receipt.replayed !== "boolean")
    throw new Error("A saved HubSpot proposal receipt was not confirmed. Check the same request again.");
  return value as CrmGatewayDecisionReceipt;
}
export function readCrmGatewayPreview(value: unknown): CrmGatewayPin | null {
  const pin = object(value), properties = object(pin.properties);
  if (pin.crm_gateway_version !== 1 || pin.provider !== "hubspot" || !operations.includes(pin.operation as HubSpotOwnerPermission) ||
      !pin.properties || typeof pin.properties !== "object" || Array.isArray(pin.properties) ||
      !uuid(pin.owner_command_id) || !uuid(pin.connection_id) || !text(pin.account_id) || !/^\d+$/.test(pin.account_id) || !text(pin.grant_revision) ||
      !Number.isSafeInteger(pin.authority_revision) || Number(pin.authority_revision) < 0 || !(pin.source_run_id === null || uuid(pin.source_run_id))) return null;
  if (pin.operation === "note.create") {
    if (!uuid(pin.source_record_id) || !timestamp(pin.source_updated_at) || !text(pin.external_id) || !/^\d+$/.test(pin.external_id) || !text(pin.source_fingerprint) || !/^[a-f\d]{64}$/i.test(pin.source_fingerprint) ||
        !(pin.source_external_updated_at === null || timestamp(pin.source_external_updated_at)) || !text(pin.note_body) || pin.note_body.length > 4000 || pin.note_body.includes("\0") ||
        Object.keys(properties).length || pin.new_identity_confirmed !== false) return null;
  } else {
    if ([pin.source_record_id, pin.source_updated_at, pin.source_external_updated_at, pin.external_id, pin.source_fingerprint, pin.note_body].some((item) => item !== null) || pin.new_identity_confirmed !== true) return null;
    try { propertiesForCreate(properties as CrmGatewayPin["properties"]); } catch { return null; }
  }
  return value as CrmGatewayPin;
}
