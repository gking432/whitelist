import test from "node:test";
import assert from "node:assert/strict";
import { probeWorkspaceAccess, workspacePermissions } from "../lib/activation/rules.ts";
import { googlePermissionScopes } from "../lib/connections/google-permissions.ts";
import { allowsActivatedGoogleInbox, allowsConnectorWork, collectActivatedGoogleInbox, suppressManagedWorkspaceIngress } from "../lib/integrations/connectors/read-only-policy.ts";
import { inboxInquiry } from "../lib/integrations/providers/inbox-message.ts";
import { getGoogleWorkspaceBusyIntervals } from "../lib/integrations/providers/google-workspace.ts";
import type { CanonicalRecord } from "../lib/integrations/connectors/types.ts";

const now = Date.now(), at = new Date(now).toISOString();
const credentials = { clientId: "synthetic-client", clientSecret: "synthetic-secret", refreshToken: "synthetic-refresh", accountId: "exact-account", accessMode: "owner_selected" as const,
  googlePermissions: ["calendar.write" as const], scope: googlePermissionScopes(["calendar.write"]).join(" ") };
const calendarConfig = { workspace_view_only: true, google_action_permissions: { calendar_write: true, email_send: false }, google_verified_scopes: credentials.scope.split(" ") };
const emailConfig = { workspace_view_only: true, google_action_permissions: { calendar_write: false, email_send: true }, google_verified_scopes: googlePermissionScopes(["email.send"]),
  activation_managed: true, conversation_intake_enabled: true, conversation_intake_enabled_at: new Date(now - 2000).toISOString(), activation_mail_verified: true, activation_checked_at: at };

test("narrow selected Google grants serve only their explicitly selected activation channel", () => {
  assert.deepEqual(workspacePermissions("google_workspace", credentials.scope, credentials, calendarConfig), { email: false, calendar: true });
  assert.deepEqual(workspacePermissions("google_workspace", credentials.scope, credentials, { workspace_view_only: true }), { email: false, calendar: false });
  assert.deepEqual(workspacePermissions("google_workspace", credentials.scope, { ...credentials, accessMode: "read_only" }, calendarConfig), { email: false, calendar: false });
  assert.deepEqual(workspacePermissions("microsoft_365", "Mail.Read Mail.Send Calendars.ReadWrite", { ...credentials, accessMode: "read_only" }, {}), { email: false, calendar: false });
});
test("calendar activation probes exact account, owned calendar and event reads without freeBusy or writes", async () => {
  const requests: { url: string; method: string }[] = [];
  const checked = await probeWorkspaceAccess("google_workspace", credentials, { config: calendarConfig, expectedAccountId: credentials.accountId,
    mintToken: async () => "synthetic-token", fetch: async (url, init) => {
      const target = String(url); requests.push({ url: target, method: init?.method ?? "GET" });
      return Response.json(target.includes("userinfo") ? { id: credentials.accountId, email: "same@synthetic.invalid" } : target.includes("calendarList") ? { id: "owned@synthetic.invalid", accessRole: "owner" } : { items: [] });
    } });
  assert.equal(checked.calendar, true); assert.equal(checked.email, false); assert.equal(checked.accountId, credentials.accountId);
  assert.equal(requests.length, 3); assert.ok(requests.every((request) => request.method === "GET" && !request.url.includes("freeBusy")));
});
test("wrong-account or unselected activation consent fails before another account capability is probed", async () => {
  let minted = 0, reads = 0;
  await assert.rejects(probeWorkspaceAccess("google_workspace", credentials, { config: {}, expectedAccountId: credentials.accountId, mintToken: async () => { minted++; return "unused"; } }));
  assert.equal(minted, 0);
  await assert.rejects(probeWorkspaceAccess("google_workspace", credentials, { config: calendarConfig, expectedAccountId: credentials.accountId,
    mintToken: async () => "synthetic", fetch: async () => { reads++; return Response.json({ id: "different-account" }); } }));
  assert.equal(reads, 1);
});
test("activated Google imports may enqueue only new ordinary inbox messages, preserving generic CRM and push blocks", () => {
  const record: CanonicalRecord = { objectType: "message", externalId: "exact-source-message", updatedAt: at, data: { sender: "customer@synthetic.invalid", body: "An explicit new inquiry", inbound: true, automated: false, has_attachments: false }, source: {} };
  assert.equal(allowsActivatedGoogleInbox(emailConfig, "live", "google_workspace", now), true);
  assert.equal(inboxInquiry(record, emailConfig, "live", now, "google_workspace")?.message, "An explicit new inquiry");
  for (const provider of ["microsoft_365", "stripe", ""]) assert.equal(inboxInquiry(record, emailConfig, "live", now, provider), null);
  for (const config of [{ ...emailConfig, activation_mail_verified: false }, { ...emailConfig, conversation_intake_enabled: false }, { ...emailConfig, activation_checked_at: new Date(now - 25 * 3600000).toISOString() }, { ...emailConfig, google_action_permissions: { email_send: false } }])
    assert.equal(inboxInquiry(record, config, "live", now, "google_workspace"), null);
  assert.equal(inboxInquiry({ ...record, updatedAt: new Date(now - 3000).toISOString() }, emailConfig, "live", now, "google_workspace"), null);
  assert.equal(inboxInquiry({ ...record, data: { ...record.data, automated: true } }, emailConfig, "live", now, "google_workspace"), null);
  assert.equal(allowsConnectorWork(emailConfig, "pull", "customer"), false); assert.equal(allowsConnectorWork(emailConfig, "pull", "lead"), false);
  assert.equal(allowsConnectorWork(emailConfig, "push", "message"), false); assert.equal(allowsConnectorWork(emailConfig, "pull", "appointment"), true);
});
test("delayed managed inbox events respect source pauses while already-selected incoming evidence continues during manager pauses", () => {
  const current = { config: emailConfig, providerKey: "google_workspace", status: "connected", runtimeMode: "live", eventType: "email.received", teamEnabled: true };
  assert.equal(suppressManagedWorkspaceIngress(current), false);
  for (const change of [{ runtimeMode: "paused" }, { status: "not_connected" }, { eventType: "sms.received" }, { config: { ...emailConfig, conversation_intake_enabled: false } }, { config: { ...emailConfig, google_action_permissions: {} } }])
    assert.equal(suppressManagedWorkspaceIngress({ ...current, ...change }), true);
  assert.equal(suppressManagedWorkspaceIngress({ ...current, teamEnabled: false }), false);
  assert.equal(collectActivatedGoogleInbox({ ...current, teamEnabled: false } as typeof current), true);
  assert.equal(suppressManagedWorkspaceIngress({ ...current, config: {}, teamEnabled: false }), false);
});
test("narrow Google calendar availability uses complete event pages, treats all-day events as busy and rejects incomplete coverage", async () => {
  const previous = globalThis.fetch, paths: string[] = [];
  let partial = false;
  globalThis.fetch = async (url) => {
    const path = String(url); paths.push(path);
    if (path.endsWith("/token")) return Response.json({ access_token: "synthetic" });
    if (path.includes("userinfo")) return Response.json({ id: credentials.accountId });
    if (path.includes("calendarList")) return Response.json({ id: "primary@synthetic.invalid", accessRole: "owner", primary: true });
    return Response.json({ items: [{ id: "all-day", start: { date: "2026-11-18" }, end: { date: "2026-11-19" } }], ...(partial ? { nextPageToken: "unknown-more" } : {}) });
  };
  try {
    const start = "2026-11-18T12:00:00Z", end = "2026-11-19T12:00:00Z";
    assert.deepEqual(await getGoogleWorkspaceBusyIntervals(credentials, start, end), [{ start, end }]);
    assert.ok(paths.every((path) => !path.includes("freeBusy")));
    partial = true; await assert.rejects(getGoogleWorkspaceBusyIntervals(credentials, start, end), /complete/);
  } finally { globalThis.fetch = previous; }
});
