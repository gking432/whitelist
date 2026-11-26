import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleCalendarReconciliationSession, type GoogleCalendarReconciliationBinding } from "../lib/integrations/providers/google-calendar-reconciliation.ts";
import type { WorkspaceCredentials } from "../lib/integrations/providers/workspace-oauth.ts";

const credentials: WorkspaceCredentials = { clientId: "synthetic-client", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh", accountId: "exact-subject", scope: "https://www.googleapis.com/auth/calendar.readonly", accessMode: "read_only" };
const binding: GoogleCalendarReconciliationBinding = { provider: "google_workspace", accountId: "exact-subject", calendarId: "primary", eventId: "exact/event", operation: "reschedule", attemptedAt: "2026-11-17T12:55:00Z" };
const now = () => "2026-11-17T13:00:00Z";
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const source = { id: binding.eventId, status: "confirmed", etag: '"new-version"', updated: "2026-11-17T12:56:00Z", organizer: { self: true }, start: { dateTime: "2026-11-18T16:00:00Z" }, end: { dateTime: "2026-11-18T17:00:00Z" } };

test("two independent observations use read-only consent, the exact account/calendar/event and GET requests only", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = []; let minted = 0;
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("userinfo")) return json({ id: "exact-subject" });
    if (String(url).includes("calendarList")) return json({ id: "owner@example.invalid", primary: true, accessRole: "owner" });
    return json(source);
  }) as typeof fetch;
  const session = await createGoogleCalendarReconciliationSession(credentials, binding, { fetch: request, now, mintToken: async () => { minted++; return "synthetic-token"; } });
  const first = await session.read(), second = await session.read();
  assert.equal(minted, 1); assert.equal(calls.length, 6); assert.equal("write" in session, false);
  assert.equal(first.account_id, binding.accountId); assert.equal(first.calendar_access_role, "owner");
  assert.equal(first.resolved_calendar_id, "owner@example.invalid"); assert.deepEqual(first.event, second.event);
  assert.equal(calls.every((call) => call.init?.method === "GET" && new Headers(call.init.headers).get("Authorization") === "Bearer synthetic-token"), true);
  assert.match(calls.at(-1)!.url, /calendars\/owner%40example.invalid\/events\/exact%2Fevent$/);
});
test("missing calendar-list read grant or a stored account mismatch stops before token minting", async () => {
  let mints = 0;
  const mintToken = async () => { mints++; throw new Error("Must not mint"); };
  await assert.rejects(createGoogleCalendarReconciliationSession({ ...credentials, scope: "https://www.googleapis.com/auth/calendar.events.readonly" }, binding, { mintToken }), /read permission/);
  await assert.rejects(createGoogleCalendarReconciliationSession({ ...credentials, accountId: "another-account" }, binding, { mintToken }), /another account/);
  assert.equal(mints, 0);
});
test("current account or ownership changes cannot become a new proof observation", async () => {
  for (const wrong of ["account", "role"]) {
    let events = 0;
    const request = (async (url: string | URL | Request) => {
      if (String(url).includes("userinfo")) return json({ id: wrong === "account" ? "another-subject" : "exact-subject" });
      if (String(url).includes("calendarList")) return json({ id: "owner@example.invalid", accessRole: "reader" });
      events++; return json(source);
    }) as typeof fetch;
    const session = await createGoogleCalendarReconciliationSession(credentials, binding, { fetch: request, now, mintToken: async () => "synthetic-token" });
    await assert.rejects(session.read(), /another account|exact owned calendar/); assert.equal(events, 0);
  }
});
test("absent cancellation reads require positive exact deleted-event coverage; partial pages never supply it", async () => {
  let partial = false;
  const paths: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = String(url); paths.push(path);
    if (path.includes("userinfo")) return json({ id: "exact-subject" });
    if (path.includes("calendarList")) return json({ id: "owner@example.invalid", accessRole: "owner" });
    if (path.includes("/events/")) return json({}, 404);
    return json({ accessRole: "owner", items: [{ ...source, status: "cancelled" }], ...(partial ? { nextPageToken: "more" } : {}) });
  }) as typeof fetch;
  const session = await createGoogleCalendarReconciliationSession(credentials, { ...binding, operation: "cancel" }, { fetch: request, now, mintToken: async () => "synthetic-token" });
  const observed = await session.read();
  assert.equal(observed.event, null); assert.equal(observed.http_status, 404); assert.equal(observed.tombstone?.id, binding.eventId); assert.equal(observed.tombstone_complete, true);
  assert.match(paths.at(-1)!, /showDeleted=true/); assert.match(paths.at(-1)!, /updatedMin=2026-11-17T12%3A55%3A00Z/); assert.doesNotMatch(paths.at(-1)!, /timeMin|timeMax/);
  partial = true;
  const incomplete = await session.read(); assert.equal(incomplete.tombstone_complete, false); assert.equal(incomplete.tombstone, null);
});
test("legacy primary-calendar identity remains separate from workspace subject identity", async () => {
  let primary = true, identityCalls = 0;
  const request = (async (url: string | URL | Request) => {
    if (String(url).includes("userinfo")) { identityCalls++; throw new Error("Legacy grants do not prove a workspace subject"); }
    if (String(url).includes("calendarList")) return json({ id: "legacy@example.invalid", primary, accessRole: "owner" });
    return json(source);
  }) as typeof fetch;
  const { accountId: _account, scope: _scope, ...legacyCredentials } = credentials;
  const session = await createGoogleCalendarReconciliationSession(legacyCredentials, { ...binding, provider: "google_calendar", accountId: "legacy@example.invalid" }, { fetch: request, now, mintToken: async () => "synthetic-token" });
  assert.equal((await session.read()).account_id, "legacy@example.invalid"); assert.equal(identityCalls, 0);
  primary = false; await assert.rejects(session.read(), /exact owned calendar/);
});
