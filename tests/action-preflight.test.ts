import assert from "node:assert/strict";
import test from "node:test";
import { ActionSuppressedError, runActionPreflight } from "../lib/jobs/action-preflight.ts";
import { sendGoogleWorkspaceEmail } from "../lib/integrations/providers/google-workspace.ts";
import { createMicrosoftCalendarEvent, sendMicrosoft365Email } from "../lib/integrations/providers/microsoft-365.ts";
import { createApprovedExternalRun } from "../lib/integrations/embedded/protocol.ts";
import type { ZapierClient } from "../lib/integrations/embedded/zapier.ts";
import { syncContactWithNote } from "../lib/integrations/providers/hubspot.ts";
import { syncGoHighLevelContactWithNote } from "../lib/integrations/providers/gohighlevel.ts";
const credentials = { clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture", scope: "Mail.Send Calendars.ReadWrite" };
const googleCredentials = { ...credentials, scope: "https://www.googleapis.com/auth/gmail.send" };
const message = { to: "fixture@example.test", subject: "Approved", body: "Fixture", idempotencyKey: "approval-fixture" };

test("Google email rechecks source after token refresh and suppresses a stale write", async () => {
  const original = globalThis.fetch;
  let stale = false;
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.includes("oauth2.googleapis.com")) {
      stale = true; // Customer response arrives while token refresh is awaited.
      return Response.json({ access_token: "fixture" });
    }
    return Response.json({ id: "must-not-send" });
  };
  try {
    await assert.rejects(sendGoogleWorkspaceEmail(googleCredentials, message,
      () => runActionPreflight(async () => stale ? "Customer replied; prepare a fresh response." : null)), ActionSuppressedError);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes("oauth2.googleapis.com"));
  } finally { globalThis.fetch = original; }
});
test("Microsoft email and booking recheck policy after token refresh before either write", async () => {
  const original = globalThis.fetch;
  let changed = false;
  const writes: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("login.microsoftonline.com")) {
      changed = true;
      return Response.json({ access_token: "fixture" });
    }
    writes.push(url);
    return Response.json({ id: "must-not-create" });
  };
  const check = () => runActionPreflight(async () => changed ? "Owner paused work." : null);
  try {
    await assert.rejects(sendMicrosoft365Email(credentials, message, check), ActionSuppressedError);
    changed = false;
    await assert.rejects(createMicrosoftCalendarEvent(credentials, { summary: "Appointment", description: "Fixture", startIso: "2026-12-01T12:00:00Z", endIso: "2026-12-01T13:00:00Z" }, check), ActionSuppressedError);
    assert.deepEqual(writes, []);
  } finally { globalThis.fetch = original; }
});
test("a permitted final preflight retains the provider receipt", async () => {
  const original = globalThis.fetch;
  const order: string[] = [];
  globalThis.fetch = async (input) => {
    if (String(input).includes("oauth2.googleapis.com")) { order.push("token"); return Response.json({ access_token: "fixture" }); }
    order.push("send"); return Response.json({ id: "actual-provider-fixture" });
  };
  try {
    const sent = await sendGoogleWorkspaceEmail(googleCredentials, message, async () => { order.push("source-check"); });
    assert.deepEqual(order, ["token", "source-check", "send"]);
    assert.equal(sent.messageId, "actual-provider-fixture");
  } finally { globalThis.fetch = original; }
});
test("Microsoft acceptance never fabricates a message ID or establishes delivery", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => String(input).includes("login.microsoftonline.com")
    ? Response.json({ access_token: "fixture" }) : new Response(null, { status: 202 });
  try {
    assert.deepEqual(await sendMicrosoft365Email(credentials, message), { messageId: null, providerPending: true });
  } finally { globalThis.fetch = original; }
});
test("provider read-only credentials block email before token refresh or write", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ access_token: "fixture" }); };
  try {
    const readonly = { ...credentials, accessMode: "read_only" as const };
    await assert.rejects(sendGoogleWorkspaceEmail(readonly, message), /read-only/);
    await assert.rejects(sendMicrosoft365Email(readonly, message), /read-only/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test("external actions recheck owner authority after asynchronous field discovery", async () => {
  let paused = false, submitted = false;
  const api = {
    authentications: async () => [{ id: "auth", app: "app", is_expired: false }],
    action: async () => ({ id: "fresh" }),
    fields: async () => { paused = true; return []; },
    request: async () => { submitted = true; return { data: { id: "must-not-submit" } }; },
  } as unknown as ZapierClient;
  const outcome = await createApprovedExternalRun(api, {
    appId: "app", authenticationId: "auth", actionKey: "create", values: {},
    onRunId: async () => { throw new Error("must not persist a nonexistent run"); },
    beforeSubmit: async () => paused ? "Owner paused work." : null,
  });
  assert.equal(outcome.status, "skipped");
  assert.equal(outcome.attempted, false);
  assert.equal(submitted, false);
});
test("legacy HubSpot inference cannot reach a lookup, create, update or note request", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    throw new Error("legacy HubSpot inference must not make a provider request");
  };
  try {
    await assert.rejects(syncContactWithNote({ privateAppToken: "fixture" },
      { email: "fixture@example.test", phone: null, firstname: null, lastname: null, address: null }, "Approved note",
      () => runActionPreflight(async () => null)), /explicit reviewed provider gateway/);
    assert.equal(paths.length, 0);
  } finally { globalThis.fetch = original; }
});
test("stopping a CRM sync after contact acceptance prevents its subsequent note and preserves the contact result", async () => {
  const original = globalThis.fetch;
  let paused = false;
  const paths: string[] = [];
  globalThis.fetch = async (input) => {
    const path = new URL(String(input)).pathname; paths.push(path);
    if (path.endsWith("/upsert")) { paused = true; return Response.json({ contact: { id: "accepted-contact" }, new: true }); }
    throw new Error("must not write a note after the stop");
  };
  try {
    const outcome = await syncGoHighLevelContactWithNote({ privateToken: "fixture", locationId: "location" },
      { email: "fixture@example.test", phone: null, firstname: null, lastname: null, address: null }, "Approved note",
      () => runActionPreflight(async () => paused ? "Owner stopped sync." : null));
    assert.equal(outcome.contactId, "accepted-contact");
    assert.equal(outcome.noteId, null);
    assert.equal(paths.length, 1);
  } finally { globalThis.fetch = original; }
});
