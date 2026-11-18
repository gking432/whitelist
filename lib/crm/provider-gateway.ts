import type { DeliveryOutcome } from "../delivery/customer-message.ts";
import type { CrmGatewayPin, CrmGatewayReceipt } from "./provider-contract.ts";
import { ActionSuppressedError } from "../jobs/action-preflight.ts";
import {
  hubSpotId, hubSpotJson, hubSpotRequest, hubSpotSourceFingerprint,
  readHubSpotObject, verifyHubSpotReadSession, type HubSpotProviderCredentials,
} from "../integrations/providers/hubspot.ts";

type GatewayOutcome = DeliveryOutcome & { crmGatewayReceipt?: CrmGatewayReceipt };
type Options = { fetch?: typeof fetch; now?: () => string };
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(v);
const clock = (v: unknown): v is string => typeof v === "string" && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const row = (v: unknown): Record<string, unknown> | null => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const sameTime = (a: string, b: string) => Date.parse(a) === Date.parse(b);
const fields: Record<string, number> = { firstname: 200, lastname: 200, email: 320, phone: 60, address: 1000 };

/** No provider operation can widen the immutable owner decision. */
export function hubSpotGatewayPinBlock(value: unknown): string | null {
  const p = row(value), properties = row(p?.properties);
  if (!p || p.crm_gateway_version !== 1 || p.provider !== "hubspot" || !["contact.create", "note.create"].includes(String(p.operation)))
    return "This HubSpot operation is unsupported. No provider request was made.";
  if (![p.owner_command_id, p.connection_id].every(uuid) || !hubSpotId(p.account_id) || typeof p.grant_revision !== "string" || !p.grant_revision || p.grant_revision.length > 2000 ||
      !Number.isSafeInteger(p.authority_revision) || Number(p.authority_revision) < 0 || !properties || typeof p.new_identity_confirmed !== "boolean" ||
      !(p.source_run_id === null || uuid(p.source_run_id))) return "The exact reviewed HubSpot account and authority pins are invalid.";
  for (const [key, value] of Object.entries(properties)) {
    if (!fields[key] || typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > fields[key] || value.includes("\0") ||
        (key === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) return "Review the deliberate new contact properties before creating a customer.";
  }
  if (p.operation === "contact.create") {
    if (!p.new_identity_confirmed || !Object.keys(properties).length || p.note_body !== null ||
        [p.source_record_id, p.source_updated_at, p.source_external_updated_at, p.external_id, p.source_fingerprint].some((v) => v !== null))
      return "Creating a contact requires a deliberate new identity decision, without an inferred existing target.";
  } else if (Object.keys(properties).length || p.new_identity_confirmed || !uuid(p.source_record_id) || !hubSpotId(p.external_id) ||
      !clock(p.source_updated_at) || !clock(p.source_external_updated_at) || typeof p.source_fingerprint !== "string" || !/^[a-f\d]{64}$/.test(p.source_fingerprint) ||
      typeof p.note_body !== "string" || !p.note_body.trim() || p.note_body.length > 6000 || p.note_body.includes("\0"))
    return "A note requires one exact reviewed imported contact, source version and note body.";
  return null;
}

/** The caller owns approval/claim/account policy and durable attempt recording.
 * This boundary never searches by identity, retries a POST, or invents provider
 * idempotency/CAS support. PATCH and delete operations are unsupported. */
export async function executeHubSpotGatewayWrite(input: {
  credentials: HubSpotProviderCredentials; pin: CrmGatewayPin;
  beforeWrite: () => Promise<void>; markAttempted: () => Promise<void>;
}, options: Options = {}): Promise<GatewayOutcome> {
  const stopped = (detail: string): GatewayOutcome => ({ status: "skipped", attempted: false, delivered: false, detail });
  const invalid = hubSpotGatewayPinBlock(input.pin);
  if (invalid) return stopped(invalid);
  const { pin, credentials } = input;
  if (!("authType" in credentials) || credentials.authType !== "oauth" || credentials.accessMode !== "owner_selected" ||
      !Array.isArray(credentials.permissions) || !credentials.permissions.includes(pin.operation) || credentials.grantRevision !== pin.grant_revision)
    return stopped("This exact HubSpot action has no current explicit owner-selected OAuth permission. Legacy private tokens remain read only.");
  let attempted = false, externalId: string | null = null;
  try {
    const now = options.now?.() ?? new Date().toISOString();
    if (!clock(now)) return stopped("A valid current provider observation clock is required.");
    const session = await verifyHubSpotReadSession(credentials, { ...options, expectedAccountId: pin.account_id });
    if (!session.scopes.includes("crm.objects.contacts.read") || !session.scopes.includes("crm.objects.contacts.write"))
      return stopped("HubSpot did not verify both contact read and selected write grants. Nothing was changed.");
    if (pin.operation === "note.create") {
      const contact = await readHubSpotObject(session, "customer", pin.external_id!, options);
      if (contact.deleted || !contact.updatedAt || !sameTime(contact.updatedAt, pin.source_external_updated_at!) || hubSpotSourceFingerprint(contact) !== pin.source_fingerprint)
        return stopped("The exact HubSpot contact changed or was archived. Prepare a fresh source review before adding a note.");
    }
    // Read-only provider requests finish before the caller's final policy check.
    await input.beforeWrite();
    // A failed or unconfirmed durable marker must never reach the provider.
    await input.markAttempted();
    attempted = true;
    const contactCreate = pin.operation === "contact.create";
    const payload = contactCreate ? { properties: pin.properties } : {
      properties: { hs_note_body: pin.note_body, hs_timestamp: now },
      associations: [{ to: { id: pin.external_id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }] }],
    };
    const response = await hubSpotRequest(session, `/crm/v3/objects/${contactCreate ? "contacts" : "notes"}`, options,
      { method: "POST", body: JSON.stringify(payload) });
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return {
      status: "failed", attempted: true, delivered: false,
      detail: `HubSpot returned HTTP ${response.status} for the saved attempt. Its durable attempt marker remains; review the provider before another request.`,
    };
    if (response.status !== 201) throw new Error("The provider did not confirm an exact created object.");
    const created = await hubSpotJson(response);
    if (!hubSpotId(created.id)) throw new Error("HubSpot did not return a usable created object ID.");
    externalId = created.id;
    const current = await readHubSpotObject(session, contactCreate ? "customer" : "note", externalId, options);
    const properties = row(current.data.properties);
    if (current.deleted || !current.updatedAt || !properties) throw new Error("The created object has no active exact readback.");
    if (contactCreate) {
      if (Object.entries(pin.properties).some(([key, value]) => properties[key] !== value)) throw new Error("The created contact properties differ from the approved decision.");
    } else {
      const contacts = current.data.associated_contact_ids;
      if (properties.hs_note_body !== pin.note_body || current.data.associations_partial !== false || !Array.isArray(contacts) || contacts.length !== 1 || contacts[0] !== pin.external_id)
        throw new Error("The exact note body and contact association were not verified.");
    }
    const verifiedAt = options.now?.() ?? new Date().toISOString();
    if (!clock(verifiedAt)) throw new Error("The receipt clock is unavailable.");
    const requestId = response.headers.get("x-hubspot-correlation-id");
    const receipt: CrmGatewayReceipt = { version: 1, provider: "hubspot", operation: pin.operation, account_id: session.accountId,
      object_id: externalId, http_status: 201, verified_at: verifiedAt, source_updated_at: current.updatedAt,
      associated_contact_id: contactCreate ? null : pin.external_id, request_id: requestId && requestId.length <= 1000 ? requestId : null };
    return { status: "succeeded", attempted: true, delivered: true, externalRef: externalId, crmGatewayReceipt: receipt,
      detail: contactCreate ? "The deliberately new HubSpot contact was created and its exact properties read back." : "The approved HubSpot note and its exact contact association were read back." };
  } catch (error) {
    if (attempted) return { status: "uncertain", attempted: true, delivered: false, externalRef: externalId,
      detail: "The saved HubSpot attempt has an uncertain result. Reconcile its exact account and object before any further write; automatic replay is disabled." };
    if (error instanceof ActionSuppressedError) return stopped(error.message);
    return { status: "failed", attempted: false, delivered: false, detail: "The current HubSpot account, source, policy or durable attempt could not be confirmed. No provider write was attempted." };
  }
}
