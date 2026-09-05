import assert from "node:assert/strict";
import { test } from "node:test";
import { executeConnectorSyncJob, type ConnectorSyncJob, type ConnectorSyncRepository } from "../lib/integrations/connectors/sync-executor.ts";
import { connectorHttpError, ConnectorAuthorizationError, ConnectorHttpError, parseRetryAfter, connectorFailurePolicy } from "../lib/integrations/connectors/errors.ts";
import type { ConnectorAdapter, ConnectorContext } from "../lib/integrations/connectors/types.ts";
import { isRingCentralChallenge, normalizePhoneWebhook } from "../lib/integrations/inbound/phone-webhooks.ts";
import { googleReviewParent } from "../lib/integrations/providers/google-business-profile.ts";
import { isBlockedAddress, isBlockedDestination, resolvePublicDestination } from "../lib/integrations/providers/outbound-webhook.ts";

const context: ConnectorContext = { connectionId: "connection", partnerId: "partner", clientId: "client", credentials: {}, config: {} };
const adapter: ConnectorAdapter = {
  manifest: { key: "reliability", name: "Reliability fixture", description: "Fault injection", category: "crm", authStrategy: "api_key", capabilities: ["customer.read", "customer.create"], verificationStatus: "contract_verified", requestable: false },
  async testConnection() { return { ok: true, detail: "fixture" }; },
  async pullPage() { return { records: [{ objectType: "customer", externalId: "external-1", data: { name: "Test" }, source: {} }], nextCursor: { page: 2 } }; },
  async pushRecord() { return { externalObjectId: "external-1" }; },
};
const job: ConnectorSyncJob = { id: "job", direction: "pull", objectType: "customer", operation: "sync", attempts: 0, maxAttempts: 3, payload: {} };
const repository: ConnectorSyncRepository = { async saveCanonicalRecord() {}, async saveCursor() {}, async saveObjectLink() {} };
const pushJob: ConnectorSyncJob = { ...job, direction: "push", operation: "create", payload: { nativeObjectId: "native-1", idempotencyKey: "create-1", data: { name: "Test" } } };

test("a failed canonical write never advances an incremental checkpoint", async () => {
  let checkpointed = false;
  const result = await executeConnectorSyncJob({ adapter, context, job, repository: {
    ...repository,
    async saveCanonicalRecord() { throw new Error("database unavailable"); },
    async saveCursor() { checkpointed = true; },
  } });
  assert.equal(result.ok, false);
  assert.equal(checkpointed, false);
  assert.equal(!result.ok && result.retryable, true);
});

test("a checkpoint failure is a failed pull, not successful ingestion", async () => {
  const result = await executeConnectorSyncJob({ adapter, context, job, repository: { ...repository, async saveCursor() { throw new Error("checkpoint unavailable"); } } });
  assert.equal(result.ok, false);
});

test("timeout after a vendor accepted a create is quarantined, never blindly retried", async () => {
  let externalWrites = 0;
  const result = await executeConnectorSyncJob({ adapter: { ...adapter, async pushRecord() { externalWrites += 1; throw new DOMException("response lost", "TimeoutError"); } }, context, job: pushJob, repository });
  assert.equal(externalWrites, 1);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.retryable, false);
  assert.equal(!result.ok && result.uncertainWrite, true);
});

test("vendor success followed by object-link failure is also quarantined", async () => {
  const result = await executeConnectorSyncJob({ adapter, context, job: pushJob, repository: { ...repository, async saveObjectLink() { throw new Error("link write unavailable"); } } });
  assert.equal(!result.ok && result.uncertainWrite, true);
  assert.equal(!result.ok && result.retryable, false);
});

test("rate-limited creates respect Retry-After; authorization failures request reconnect", async () => {
  const result = await executeConnectorSyncJob({ adapter: { ...adapter, async pushRecord() { throw connectorHttpError("fixture", new Response(null, { status: 429, headers: { "Retry-After": "120" } })); } }, context, job: pushJob, repository });
  assert.equal(!result.ok && result.retryable, true);
  assert.equal(!result.ok && result.retryAfterSeconds, 120);
  const rejected = connectorHttpError("fixture", new Response(null, { status: 401 }));
  assert.ok(rejected instanceof ConnectorAuthorizationError);
  assert.equal(connectorFailurePolicy(rejected,{ ...job }).reconnectRequired,true);
  assert.equal(connectorFailurePolicy(new ConnectorHttpError("outage",503),{ ...job, attempts: 2 }).retryable,false);
  assert.equal(parseRetryAfter("Fri, 04 Sep 2026 12:02:00 GMT", Date.parse("2026-09-04T12:00:00Z")),120);
});

test("RingCentral notifications carrying validation tokens are not registration challenges", () => {
  assert.equal(isRingCentralChallenge("", "challenge"), true);
  assert.equal(isRingCentralChallenge('{"body":{"telephonySessionId":"call"}}', "secret"), false);
  assert.equal(isRingCentralChallenge("", null), false);
  const active = normalizePhoneWebhook("ringcentral", { uuid: "event", body: { telephonySessionId: "call", parties: [{ direction: "Inbound", status: { code: "Answered" }, from: { phoneNumber: "+13125550100" } }] } });
  assert.equal(active.type, "call.updated");
  assert.equal(active.from, "+13125550100");
});

test("provider payload fallback IDs remain stable across retries", () => {
  const payload = { type: "call.completed", data: { object: {} } };
  assert.equal(normalizePhoneWebhook("openphone", payload).id,normalizePhoneWebhook("openphone", payload).id);
});

test("Business Profile v1 locations are joined with the account for reviews", () => {
  assert.equal(googleReviewParent({accountName:"accounts/123",locationName:"locations/456"}),"accounts/123/locations/456");
  assert.equal(googleReviewParent({accountName:"accounts/123",locationName:"accounts/123/locations/456"}),"accounts/123/locations/456");
  assert.throws(()=>googleReviewParent({accountName:"accounts/123",locationName:"https://evil.test"}));
});

test("outbound webhook DNS rebinding and mixed public/private answers are rejected", async () => {
  await assert.rejects(resolvePublicDestination("https://hooks.example.com", async () => [{address:"127.0.0.1",family:4}]), /non-public/);
  await assert.rejects(resolvePublicDestination("https://hooks.example.com", async () => [{address:"8.8.8.8",family:4},{address:"10.0.0.1",family:4}]), /non-public/);
  const publicEndpoint = await resolvePublicDestination("https://hooks.example.com", async () => [{address:"8.8.8.8",family:4}]);
  assert.equal(publicEndpoint.address,"8.8.8.8");
  for (const address of ["::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "100.64.0.1", "224.0.0.1"]) assert.equal(isBlockedAddress(address),true,address);
  assert.equal(isBlockedDestination("https://user:pass@example.com"),true);
  assert.equal(isBlockedDestination("https://example.com:8443"),true);
});

test("public beta catalog does not advertise writes with no application producer", async () => {
  const { CONNECTOR_CATALOG } = await import("../lib/integrations/connectors/catalog.ts");
  for (const provider of ["quickbooks_online","stripe","square","google_business_profile","podium"]) {
    const manifest = CONNECTOR_CATALOG.find((item) => item.key===provider)!;
    assert.ok(manifest.capabilities.every((capability)=>capability.endsWith(".read")),provider);
  }
});

test("Workspace refresh stores the rotated refresh token before returning access", async () => {
  const { registerCredentialStore } = await import("../lib/integrations/credential-lifecycle.ts");
  const { mintWorkspaceAccessToken } = await import("../lib/integrations/providers/workspace-oauth.ts");
  const credentials = { clientId:"fixture",clientSecret:"fixture",refreshToken:"old-fixture-token" };
  const originalFetch=globalThis.fetch;
  let stored=false;
  registerCredentialStore(credentials,async(updated)=>{ assert.equal((updated as typeof credentials).refreshToken,"new-fixture-token");stored=true; });
  globalThis.fetch=async()=>Response.json({access_token:"access-fixture-token",refresh_token:"new-fixture-token"});
  try {
    const result=await mintWorkspaceAccessToken("microsoft_365",credentials);
    assert.equal(result,"access-fixture-token");
    assert.equal(stored,true);
    assert.equal(credentials.refreshToken,"new-fixture-token");
  } finally { globalThis.fetch=originalFetch; }
});

test("calendar availability fails closed on omitted or per-calendar failures", async () => {
  const { googleBusyIntervals, microsoftBusyIntervals } = await import("../lib/integrations/providers/calendar-availability.ts");
  for (const body of [{}, { calendars: { primary: { errors: [{ reason: "notFound" }] } } }, { calendars: { primary: { busy: [{ start: "bad", end: "bad" }] } } }]) {
    assert.throws(() => googleBusyIntervals(body));
  }
  assert.deepEqual(googleBusyIntervals({ calendars: { primary: { busy: [] } } }), []);
  for (const body of [{}, { value: [] }, { value: [{ scheduleId: "wrong@example.test", scheduleItems: [] }] }, { value: [{ scheduleId: "a@example.test", error: { responseCode: "Error" }, scheduleItems: [] }] }]) {
    assert.throws(() => microsoftBusyIntervals(body, "a@example.test"));
  }
  assert.deepEqual(microsoftBusyIntervals({ value: [{ scheduleId: "a@example.test", scheduleItems: [{ status: "busy", start: { dateTime: "2026-09-04T12:00:00", timeZone: "UTC" }, end: { dateTime: "2026-09-04T13:00:00", timeZone: "UTC" } }] }] }, "a@example.test"), [{ start: "2026-09-04T12:00:00Z", end: "2026-09-04T13:00:00Z" }]);
});

test("a connection paused after batch selection cancels before any provider effect", async () => {
  const { ConnectorExecutionCancelledError } = await import("../lib/integrations/connectors/errors.ts");
  let providerCalls = 0;
  const result = await executeConnectorSyncJob({ adapter: { ...adapter, async pushRecord() { providerCalls += 1; return { externalObjectId: "created" }; } }, context, job: pushJob,
    repository: { ...repository, async assertCanExecute() { throw new ConnectorExecutionCancelledError(); } } });
  assert.equal(providerCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.cancelled, true);
  assert.equal(!result.ok && result.retryable, false);
});

test("legacy CRM contact/note failures cannot become replayable action jobs", async () => {
  const { crmSyncDeliveryStatus, legacyCrmSyncNeedsReconciliation } = await import("../lib/crm/sync-outcome.ts");
  const { actionCanBeClaimed } = await import("../lib/jobs/execution-state.ts");
  for (const result of ["failed", "uncertain"]) {
    const status = crmSyncDeliveryStatus(result);
    assert.equal(status, "uncertain");
    assert.equal(actionCanBeClaimed(status), false);
    assert.equal(actionCanBeClaimed(status, true), false);
  }
  assert.equal(legacyCrmSyncNeedsReconciliation({ kind: "crm.sync", status: "failed" }), true);
  assert.equal(legacyCrmSyncNeedsReconciliation({ kind: "crm.sync", status: "dry_run" }), false);
  assert.equal(legacyCrmSyncNeedsReconciliation({ kind: "email.send", status: "failed" }), false);
  assert.equal(crmSyncDeliveryStatus("synced"), "succeeded");
});
