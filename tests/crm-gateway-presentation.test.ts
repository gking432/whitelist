import test from "node:test";
import assert from "node:assert/strict";
import type { ConnectedCrmDeal, ConnectedCustomer, CrmGatewayPin, CrmGatewayReview } from "../lib/crm/provider-contract.ts";
import { associatedCrmDeals, buildCrmGatewayCommand, crmDealAmount, crmReviewBlock, crmSourceRunId, crmSourceTime, hubspotSetupHref, hubspotSourceHref, readCrmGatewayPreview, readCrmGatewayReceipt, readCrmGatewayReview } from "../lib/crm/gateway-presentation.ts";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const clock = "2026-11-17T13:00:00Z";
const contact: ConnectedCustomer = { id: id(1), connectionId: id(2), externalId: "123", accountId: "456", account: "Business HubSpot", name: "Source contact",
  email: "source@example.test", phone: null, lifecycleStage: "lead", archived: false, sourceUpdatedAt: clock, observedAt: clock, revision: "source-r3", href: "https://app.hubspot.com/contacts/456/contact/123" };
const review: CrmGatewayReview = { version: 1, connectionId: id(2), accountId: "456", account: "Business HubSpot", revision: "exact-account-r7", canWrite: true,
  selectedCrm: true, actionsEnabled: true, permissions: ["note.create", "contact.create"], contact, blockReason: null, existing: null };
const pin: CrmGatewayPin = { crm_gateway_version: 1, provider: "hubspot", operation: "note.create", owner_command_id: id(3), connection_id: id(2), account_id: "456", grant_revision: "grant-r1",
  authority_revision: 4, source_record_id: id(1), source_updated_at: clock, source_external_updated_at: clock, external_id: "123", source_fingerprint: "a".repeat(64),
  properties: {}, note_body: "Call reviewed; no outreach authorized.", new_identity_confirmed: false, source_run_id: null };

test("HubSpot navigation rejects other portals, credentials, fake suffixes and executable URLs", () => {
  assert.equal(hubspotSetupHref("https://app.hubspot.com/signup-hubspot/crm"), "https://app.hubspot.com/signup-hubspot/crm");
  assert.equal(hubspotSourceHref(contact.href, "456"), contact.href);
  assert.equal(hubspotSourceHref("https://app-eu1.hubspot.com/contacts/456/record/0-1/123", "456"), "https://app-eu1.hubspot.com/contacts/456/record/0-1/123");
  for (const href of ["javascript:alert(1)", "https://app.hubspot.com.evil.test/contacts/456/contact/123", "http://app.hubspot.com/contacts/456/contact/123", "https://user:password@app.hubspot.com/contacts/456/contact/123", "https://app.hubspot.com:8443/contacts/456/contact/123"])
    assert.equal(hubspotSetupHref(href), null);
  assert.equal(hubspotSourceHref(contact.href, "999"), null);
});

test("deal context uses exact account/connection/contact associations and never converts pipeline amounts", () => {
  const deal: ConnectedCrmDeal = { id: id(8), connectionId: id(2), externalId: "987", accountId: "456", account: "Business HubSpot", name: "Pipeline source", stage: "qualified", pipeline: null,
    amount: "9007199254740993.1234", currency: "usd", contactIds: ["123"], associationsPartial: false, archived: false, sourceUpdatedAt: clock, observedAt: clock, href: null };
  assert.deepEqual(associatedCrmDeals(contact, [deal, { ...deal, connectionId: id(9) }, { ...deal, accountId: "999" }, { ...deal, contactIds: ["source@example.test"] }]), [deal]);
  assert.equal(crmDealAmount(deal.amount, deal.currency), "9007199254740993.1234 USD");
  assert.equal(crmDealAmount("10.50", null), "10.50 · Currency unavailable");
  assert.equal(crmDealAmount(null, "USD"), "Amount unavailable");
  assert.equal(crmSourceTime("unknown", "UTC"), null);
});

test("review loading binds exact account and source and never turns an imported contact into a default new target", () => {
  assert.deepEqual(readCrmGatewayReview(review, { connectionId: id(2), recordId: id(1) }), review);
  for (const changed of [{ ...review, connectionId: id(5) }, { ...review, contact: { ...contact, id: id(5) } }, { ...review, contact: { ...contact, accountId: "999" } }, { ...review, permissions: ["email.send"] }])
    assert.throws(() => readCrmGatewayReview(changed, { connectionId: id(2), recordId: id(1) }), /exact HubSpot account/);
  assert.throws(() => readCrmGatewayReview(review, { connectionId: id(2) }), /exact HubSpot account/);
  assert.equal(readCrmGatewayReview({ ...review, contact: null }, { connectionId: id(2) }).contact, null);
});

test("note proposals keep exact source pins and confirmation without hidden property changes or outreach authority", () => {
  const result = buildCrmGatewayCommand(review, "note.create", id(6), { targetConfirmed: true, note: "  Reviewed note  ", properties: { email: "different@example.test" }, newIdentityConfirmed: true });
  assert.deepEqual(result, { action: "prepare_hubspot_change", key: id(6), connectionId: id(2), expectedRevision: "exact-account-r7", operation: "note.create", targetConfirmed: true,
    recordId: id(1), expectedSourceRevision: "source-r3", note: "Reviewed note" });
  assert.throws(() => buildCrmGatewayCommand(review, "note.create", id(6), { note: "Note" }), /Explicitly review/);
  assert.throws(() => buildCrmGatewayCommand(review, "note.create", id(6), { targetConfirmed: true, note: "x".repeat(4001) }), /4,000/);
  for (const changed of [{ ...review, canWrite: false }, { ...review, selectedCrm: false }, { ...review, actionsEnabled: false }, { ...review, permissions: [] }, { ...review, blockReason: "Partial source import." }, { ...review, contact: { ...contact, archived: true } }])
    assert.ok(crmReviewBlock(changed, "note.create"));
});

test("new external customers require fresh duplicate review and only deliberately entered bounded properties", () => {
  const createReview = { ...review, contact: null };
  const result = buildCrmGatewayCommand(createReview, "contact.create", id(6), { targetConfirmed: true, newIdentityConfirmed: true, properties: { firstname: "  New name  ", email: "new@example.test", phone: " " }, note: "Hidden old note" });
  assert.deepEqual(result, { action: "prepare_hubspot_change", key: id(6), connectionId: id(2), expectedRevision: "exact-account-r7", operation: "contact.create", targetConfirmed: true,
    newIdentityConfirmed: true, properties: { firstname: "New name", email: "new@example.test" } });
  assert.throws(() => buildCrmGatewayCommand(createReview, "contact.create", id(6), { targetConfirmed: true, properties: { firstname: "Name" } }), /deliberately new customer/);
  assert.throws(() => buildCrmGatewayCommand(createReview, "contact.create", id(6), { targetConfirmed: true, newIdentityConfirmed: true, properties: { address: "An address alone" } }), /name, email or phone/);
  assert.throws(() => buildCrmGatewayCommand(createReview, "contact.create", id(6), { targetConfirmed: true, newIdentityConfirmed: true, properties: { firstname: "x".repeat(101) } }), /too long/);
  assert.throws(() => buildCrmGatewayCommand(createReview, "contact.create", id(6), { targetConfirmed: true, newIdentityConfirmed: true, properties: { email: "invalid" } }), /email address/);
});

test("saved proposals require a correlated durable receipt and previews retain only valid immutable targets", () => {
  const receipt = { id: id(7), approvalId: id(8), connectionId: id(2), message: "HubSpot proposal saved for approval.", replayed: true };
  assert.deepEqual(readCrmGatewayReceipt(receipt, id(2)), receipt);
  for (const changed of [{ ...receipt, connectionId: id(9) }, { ...receipt, approvalId: null }, { ...receipt, replayed: "true" }])
    assert.throws(() => readCrmGatewayReceipt(changed, id(2)), /receipt was not confirmed/);
  assert.deepEqual(readCrmGatewayPreview(pin), pin);
  for (const changed of [{ ...pin, properties: { email: "overwrite@example.test" } }, { ...pin, properties: [] }, { ...pin, source_record_id: null }, { ...pin, operation: "contact.update" }, { ...pin, note_body: "x".repeat(4001) }])
    assert.equal(readCrmGatewayPreview(changed), null);
  const createPin = { ...pin, operation: "contact.create", properties: { firstname: "Deliberately new" }, source_record_id: null, source_updated_at: null, source_external_updated_at: null,
    external_id: null, source_fingerprint: null, note_body: null, new_identity_confirmed: true };
  assert.deepEqual(readCrmGatewayPreview(createPin), createPin);
});

test("saved-work references are exact UUIDs carried without inferring a CRM target or fields", () => {
  assert.equal(crmSourceRunId(id(9)), id(9));
  for (const value of [undefined, "", "customer@example.test", [id(9)], `${id(9)}?contact=123`]) assert.equal(crmSourceRunId(value), undefined);
  const linked = { ...review, sourceRun: { id: id(9), summary: "Source context only", eventType: "form.submitted", templateKey: "customer_intake", createdAt: clock } };
  const command = buildCrmGatewayCommand(linked, "note.create", id(6), { targetConfirmed: true, note: "Reviewed exact source", sourceRunId: id(9) });
  assert.equal(command.sourceRunId, id(9)); assert.equal(command.recordId, id(1)); assert.equal("properties" in command, false);
  assert.throws(() => buildCrmGatewayCommand(review, "note.create", id(6), { targetConfirmed: true, note: "Reviewed", sourceRunId: id(9) }), /read the exact saved work/);
  assert.throws(() => readCrmGatewayReview(linked, { connectionId: id(2), recordId: id(1), sourceRunId: id(8) }), /exact HubSpot account/);
  assert.deepEqual(readCrmGatewayReview(linked, { connectionId: id(2), recordId: id(1), sourceRunId: id(9) }).sourceRun, linked.sourceRun);
});
