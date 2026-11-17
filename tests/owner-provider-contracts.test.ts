import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkspaceAuthorizationUrl, verifyWorkspaceOAuthState, MICROSOFT_365_READ_SCOPES, exchangeWorkspaceCode, mintWorkspaceAccessToken, hasWorkspaceReadGrants } from "../lib/integrations/providers/workspace-oauth.ts";
import { ownerProviderOptions } from "../lib/connections/provider-options.ts";
import { allowsConnectorWork, connectorCursorIsPartial } from "../lib/integrations/connectors/read-only-policy.ts";
import { microsoft365Adapter, mapMicrosoftDeltaRecord, mapMicrosoftEvent, microsoftDateTime } from "../lib/integrations/providers/microsoft-365.ts";
const credentials = { clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture", accessMode: "read_only" as const };

test("Microsoft read-only OAuth signs its own provider/attempt and requests only read capabilities with PKCE", () => {
  const previous = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");
  try {
    const url = new URL(buildWorkspaceAuthorizationUrl("microsoft_365", credentials, "exact-account", undefined,
      { attemptId: "attempt", challenge: "challenge", readOnly: true }));
    assert.deepEqual(url.searchParams.get("scope")?.split(" "), [...MICROSOFT_365_READ_SCOPES]);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.ok(url.searchParams.get("redirect_uri")?.endsWith("/api/oauth/microsoft/callback"));
    const state = verifyWorkspaceOAuthState(url.searchParams.get("state")!);
    assert.equal(state?.providerKey, "microsoft_365");
    assert.equal(state?.connectionId, "exact-account");
    assert.equal(state?.readOnlyAttemptId, "attempt");
    assert.equal(state?.activationAttemptId, undefined);
    assert.ok(!/Write|Mail\.Send|Contacts\./.test(url.searchParams.get("scope")!));
  } finally {
    if (previous === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = previous;
  }
});
test("Microsoft code exchange and refresh preserve read-only marker and never reuse elevated refresh scopes", async () => {
  const original = globalThis.fetch;
  const requests: URLSearchParams[] = [];
  globalThis.fetch = async (_url, init) => {
    const body = new URLSearchParams(String(init?.body)); requests.push(body);
    return body.get("grant_type") === "authorization_code"
      ? Response.json({ refresh_token: "fixture-refresh", scope: MICROSOFT_365_READ_SCOPES.join(" ") })
      : Response.json({ access_token: "fixture-access" });
  };
  try {
    const exchanged = await exchangeWorkspaceCode("microsoft_365", credentials, "code", "verifier", true);
    assert.equal(exchanged.ok, true);
    if (exchanged.ok) assert.equal(exchanged.credentials.accessMode, "read_only");
    assert.equal(requests[0].get("code_verifier"), "verifier");
    await mintWorkspaceAccessToken("microsoft_365", { ...credentials, scope: "Mail.Send Calendars.ReadWrite" });
    assert.deepEqual(requests[1].get("scope")?.split(" "), [...MICROSOFT_365_READ_SCOPES]);
    assert.equal(hasWorkspaceReadGrants("microsoft_365", "User.Read Mail.Read Calendars.Read"), true);
    assert.equal(hasWorkspaceReadGrants("microsoft_365", "User.Read Mail.Read"), false);
  } finally { globalThis.fetch = original; }
});
test("owner provider choices expose setup readiness without credentials or connected claims", () => {
  const unavailable = ownerProviderOptions({ google: true, microsoft: true, secureStorage: false });
  assert.ok(unavailable.every((option) => option.available === false));
  const ready = ownerProviderOptions({ google: true, microsoft: false, secureStorage: true });
  assert.equal(ready.find((p) => p.key === "google_workspace")?.available, true);
  assert.equal(ready.find((p) => p.key === "microsoft_365")?.available, false);
  assert.equal(ready.find((p) => p.key === "stripe")?.setup, "operator");
  assert.equal(ready.find((p) => p.key === "generic_inbound_webhook")?.setup, "token");
  assert.equal(JSON.stringify(ready).includes("clientSecret"), false);
});
test("read-only money imports permit invoice/payment reads and no customer projection or writes", () => {
  const config = { workspace_view_only: true };
  for (const stream of ["message", "appointment", "invoice", "payment"]) {
    assert.equal(allowsConnectorWork(config, "pull", stream), true);
    assert.equal(allowsConnectorWork(config, "push", stream), false);
  }
  assert.equal(allowsConnectorWork(config, "pull", "customer"), false);
});
test("partial mail/calendar/money cursors cannot establish completed reconciliation", () => {
  for (const cursor of [{ pageToken: "next" }, { nextLink: "https://graph.microsoft.com/next" }, { after: "pi_next" }])
    assert.equal(connectorCursorIsPartial(cursor), true);
  for (const cursor of [null, { deltaLink: "checkpoint" }, { historyId: "checkpoint" }, { syncToken: "checkpoint" }])
    assert.equal(connectorCursorIsPartial(cursor), false);
});
test("Microsoft inbox scope establishes inbound direction; arbitrary message metadata establishes neither direction nor UTC", () => {
  const source = { id: "mail", subject: "Question", from: { emailAddress: { address: "person@example.test" } }, isDraft: false,
    receivedDateTime: "2026-11-17T10:00:00Z", lastModifiedDateTime: "2026-11-17T11:00:00Z", webLink: "https://outlook.office.com/mail/id/mail" };
  assert.equal(mapMicrosoftDeltaRecord("message", source).data.direction, "unknown");
  const inbox = mapMicrosoftDeltaRecord("message", source, { folder: "inbox" });
  assert.equal(inbox.data.direction, "inbound");
  assert.equal(inbox.data.inbox, true);
  assert.equal(inbox.data.received_at, source.receivedDateTime);
  assert.equal(inbox.updatedAt, source.lastModifiedDateTime);
  assert.equal(microsoftDateTime("2026-11-17T10:00:00.0000000", "Pacific Standard Time"), null);
  const event = mapMicrosoftEvent({ id: "event", isAllDay: false, lastModifiedDateTime: "2026-11-17T09:00:00Z",
    start: { dateTime: "2026-11-17T10:00:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-17T11:00:00.0000000", timeZone: "UTC" } });
  assert.equal(event.data.start_at, "2026-11-17T10:00:00.000Z");
  assert.equal(event.updatedAt, "2026-11-17T09:00:00Z");
});
test("Microsoft read-only calendar import requests UTC, keeps the delta window stable, and retains deletion evidence", async () => {
  const original = globalThis.fetch;
  const paths: string[] = [];
  const preference: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("login.microsoftonline.com")) return Response.json({ access_token: "fixture" });
    paths.push(url); preference.push(String((init?.headers as Record<string, string>)?.Prefer));
    return Response.json({ value: [{ id: "deleted", "@removed": { reason: "deleted" } }],
      "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=fixture" });
  };
  try {
    const context = { credentials, connectionId: "account", clientId: "business", partnerId: "partner", config: { workspace_view_only: true } };
    const first = await microsoft365Adapter.pullPage!(context, "appointment", null);
    assert.equal(first.records[0].deleted, true);
    assert.ok(typeof first.records[0].data.observed_at === "string");
    assert.ok(preference[0].includes('outlook.timezone="UTC"'));
    const window = new URL(paths[0]);
    assert.ok((Date.parse(window.searchParams.get("endDateTime")!) - Date.parse(window.searchParams.get("startDateTime")!)) / 86400000 === 63);
    await microsoft365Adapter.pullPage!(context, "appointment", first.nextCursor);
    assert.equal(paths[1], first.nextCursor?.deltaLink);
  } finally { globalThis.fetch = original; }
});
