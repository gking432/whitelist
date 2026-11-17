import test from "node:test";
import assert from "node:assert/strict";
import { executeApprovedCalendarMutation, executePinnedCalendarMutation, getCalendarMutationOffer } from "../lib/scheduling/calendar-mutation.ts";
import { createGoogleWorkspaceCalendarMutationSession, GoogleCalendarMutationHttpError } from "../lib/integrations/providers/google-workspace.ts";
import type { CalendarMutationEvent, CalendarMutationPayload, CalendarMutationSession } from "../lib/scheduling/calendar-mutation-rules.ts";
import type { WorkspaceCredentials } from "../lib/integrations/providers/workspace-oauth.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../lib/jobs/record.ts";

const now = "2026-11-17T12:00:00Z";
function payload(): CalendarMutationPayload {
  return { calendar_mutation_version: 1, mutation: "reschedule", booking_approval_id: "original", booking_action_job_id: "original-job", appointment_id: "native", appointment_updated_at: "2026-11-17T10:00:00Z",
    contact_id: "person", contact_updated_at: "2026-11-17T09:00:00Z", provider: "google_workspace", calendar_connection_id: "connection", calendar_account_id: "account-id", calendar_id: "primary", external_ref: "exact-event",
    source_record_id: "source", source_updated_at: "2026-11-17T10:01:00Z", source_etag: '"original-etag"', old_slot: { start_iso: "2026-11-18T12:00:00Z", end_iso: "2026-11-18T13:00:00Z" },
    new_slot: { start_iso: "2026-11-18T12:30:00Z", end_iso: "2026-11-18T13:30:00Z" }, authority_revision: 4, customer_activity_id: null, customer_activity_at: null, conversation_id: null, conversation_revision: null };
}
function event(p = payload()): CalendarMutationEvent { return { id: p.external_ref, etag: p.source_etag, updatedAt: p.source_updated_at, status: "confirmed", slot: p.old_slot, organizerSelf: true, recurring: false, attendeeCount: 0, eventType: "default" }; }
function session(p = payload()) {
  let reads = 0, writes = 0;
  const api: CalendarMutationSession = { readEvent: async () => ++reads === 1 ? event(p) : { ...event(p), etag: '"provider-new-etag"', updatedAt: "2026-11-17T11:59:00Z", slot: p.new_slot! },
    busyForSlot: async () => [], write: async () => { writes++; return { status: 200, requestId: "real-header" }; } };
  return { api, writes: () => writes, reads: () => reads };
}
test("successful time change uses actual response/request header and exact readback proof", async () => {
  const p = payload(), api = session(p); let checks = 0;
  const result = await executePinnedCalendarMutation(p, { check: async () => { checks++; return null; }, session: async () => api.api, now: () => now });
  assert.equal(result.status, "succeeded"); assert.equal(checks, 2); assert.equal(api.writes(), 1);
  assert.equal(result.calendarMutationReceipt?.request_id, "real-header"); assert.equal(result.calendarMutationReceipt?.event_etag, '"provider-new-etag"');
  assert.deepEqual(result.calendarMutationReceipt?.new_slot, p.new_slot);
});
test("policy changed during token refresh suppresses final provider write", async () => {
  const api = session(); let minted = false;
  const result = await executePinnedCalendarMutation(payload(), { check: async () => minted ? "The owner paused scheduling." : null,
    session: async () => { minted = true; return api.api; }, now: () => now });
  assert.equal(result.status, "skipped"); assert.equal(api.writes(), 0); assert.equal(result.attempted, false);
});
test("busy replacement and changed exact event never reach the write", async () => {
  for (const patch of [{ busyForSlot: async () => [{ start: "2026-11-18T13:00:00Z", end: "2026-11-18T14:00:00Z" }] },
    { readEvent: async () => ({ ...event(), etag: '"changed"' }) }, { readEvent: async () => null }]) {
    const api = session(); Object.assign(api.api, patch);
    const result = await executePinnedCalendarMutation(payload(), { check: async () => null, session: async () => api.api, now: () => now });
    assert.equal(result.status, "skipped"); assert.equal(api.writes(), 0);
  }
});
test("412 is a stale decision, transport/5xx or ambiguous readback is uncertain and never retried", async () => {
  for (const [failure, expected] of [[new GoogleCalendarMutationHttpError(412), "skipped"], [new GoogleCalendarMutationHttpError(503), "uncertain"], [new Error("network reset"), "uncertain"]] as const) {
    const api = session(); let calls = 0; api.api.write = async () => { calls++; throw failure; };
    const result = await executePinnedCalendarMutation(payload(), { check: async () => null, session: async () => api.api, now: () => now });
    assert.equal(result.status, expected); assert.equal(calls, 1); assert.equal(result.delivered, false);
  }
  const api = session(); api.api.readEvent = async () => event();
  assert.equal((await executePinnedCalendarMutation(payload(), { check: async () => null, session: async () => api.api, now: () => now })).status, "uncertain");
  assert.equal(api.writes(), 1);
});
test("successful cancellation requires acknowledged delete and exact absent readback", async () => {
  const p = { ...payload(), mutation: "cancel" as const, new_slot: undefined }, api = session(p); let reads = 0;
  api.api.readEvent = async () => ++reads === 1 ? event(p) : null;
  api.api.write = async () => ({ status: 204, requestId: null });
  const result = await executePinnedCalendarMutation(p, { check: async () => null, session: async () => api.api, now: () => now });
  assert.equal(result.status, "succeeded"); assert.equal(result.calendarMutationReceipt?.verified_absent, true); assert.equal(result.calendarMutationReceipt?.http_status, 204);
  let secondReads = 0;
  api.api.readEvent = async () => ++secondReads === 1 ? event(p) : { ...event(p), status: "cancelled" };
  assert.equal((await executePinnedCalendarMutation(p, { check: async () => null, session: async () => api.api, now: () => now })).status, "uncertain");
});
test("Microsoft unproven conditional writes stay unavailable without token or HTTP work", async () => {
  let opened = false;
  const result = await executePinnedCalendarMutation({ ...payload(), provider: "microsoft_365" }, { check: async () => null, session: async () => { opened = true; throw new Error("No provider call"); }, now: () => now });
  assert.equal(result.status, "skipped"); assert.equal(opened, false);
});
test("Scenario Lab cannot invoke a mutation database or provider effect", async () => {
  const admin = new Proxy({}, { get: () => { throw new Error("No database call is allowed"); } }) as SupabaseClient;
  const result = await executeApprovedCalendarMutation(admin, { kind: "calendar.cancel", payload: { scenario_lab: true } } as unknown as ActionJobRecord);
  assert.equal(result.status, "dry_run"); assert.equal(result.delivered, false);
});

const credentials: WorkspaceCredentials = { clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture", scope: "https://www.googleapis.com/auth/calendar", accountId: "account-id" };
const binding = { accountId: "account-id", calendarId: "primary", eventId: "exact-event" };
const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
test("readonly or missing write consent rejects before minting; another token account rejects before event reads", async () => {
  let mints = 0, calls = 0;
  const dependencies = { mintToken: async () => { mints++; return "test-token"; }, fetch: (async () => { calls++; return json({ id: "another-account" }); }) as typeof fetch };
  await assert.rejects(createGoogleWorkspaceCalendarMutationSession({ ...credentials, accessMode: "read_only" }, binding, dependencies), /read only/);
  await assert.rejects(createGoogleWorkspaceCalendarMutationSession({ ...credentials, scope: "https://www.googleapis.com/auth/calendar.events.readonly" }, binding, dependencies), /write consent/);
  assert.equal(mints, 0);
  await assert.rejects(createGoogleWorkspaceCalendarMutationSession(credentials, binding, dependencies), /another account/);
  assert.equal(mints, 1); assert.equal(calls, 1);
});
test("Google availability excludes only the exact source event and refuses partial pages", async () => {
  let partial = false;
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), method: init?.method ?? "GET", headers: new Headers(init?.headers) });
    if (String(url).includes("userinfo")) return json({ id: "account-id" });
    if (String(url).includes("calendarList")) return json({ id: "owner@example.com", primary: true, accessRole: "owner" });
    return json({ items: [{ id: "exact-event", start: { dateTime: "2026-11-18T12:00:00Z" }, end: { dateTime: "2026-11-18T13:00:00Z" } },
      { id: "different-event-same-title", start: { dateTime: "2026-11-18T13:00:00Z" }, end: { dateTime: "2026-11-18T14:00:00Z" } }], ...(partial ? { nextPageToken: "more" } : {}) });
  }) as typeof fetch;
  const api = await createGoogleWorkspaceCalendarMutationSession(credentials, binding, { mintToken: async () => "test-token", fetch: request });
  assert.deepEqual(await api.busyForSlot(payload().new_slot!), [{ start: "2026-11-18T13:00:00Z", end: "2026-11-18T14:00:00Z" }]);
  assert.match(requests.at(-1)!.url, /owner%40example.com/); assert.equal(requests.every((r) => r.method === "GET"), true);
  partial = true; await assert.rejects(api.busyForSlot(payload().new_slot!), /full replacement-slot availability/);
});
test("Google write preserves opaque If-Match and patches only approved start/end", async () => {
  let written: RequestInit | undefined, address = "";
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("userinfo")) return json({ id: "account-id" });
    if (String(url).includes("calendarList")) return json({ id: "owner@example.com", primary: true, accessRole: "owner" });
    written = init; address = String(url); return json({}, 200, { "x-request-id": "provider-header-value" });
  }) as typeof fetch;
  const api = await createGoogleWorkspaceCalendarMutationSession(credentials, binding, { mintToken: async () => "test-token", fetch: request });
  assert.deepEqual(await api.write(payload()), { status: 200, requestId: "provider-header-value" });
  assert.equal(new Headers(written!.headers).get("If-Match"), '"original-etag"'); assert.equal(written!.method, "PATCH");
  assert.deepEqual(JSON.parse(String(written!.body)), { start: { dateTime: payload().new_slot!.start_iso }, end: { dateTime: payload().new_slot!.end_iso } });
  assert.match(address, /events\/exact-event\?sendUpdates=none$/);
});
test("offer helper is read-only and keeps existing event available for overlapping replacement times", async () => {
  const api = session(); let writes = 0; api.api.write = async () => { writes++; throw new Error("Must not write an offer"); };
  const result = await getCalendarMutationOffer(credentials, payload(), payload().new_slot!, { session: async () => api.api, now: () => now });
  assert.deepEqual(result.busy, []); assert.equal(result.observedAt, now); assert.equal(writes, 0);
});
