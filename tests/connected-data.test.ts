import test from "node:test";
import assert from "node:assert/strict";
import {
  mapConnectedData,
  type ImportedRow,
} from "../lib/connections/records.ts";
import type { ConnectedApp } from "../lib/connections/types.ts";
import {
  buildWorkspaceAuthorizationUrl,
  verifyWorkspaceOAuthState,
  GOOGLE_WORKSPACE_READ_SCOPES,
} from "../lib/integrations/providers/workspace-oauth.ts";
import { allowsConnectorWork } from "../lib/integrations/connectors/read-only-policy.ts";
import { inboxInquiry } from "../lib/integrations/providers/inbox-message.ts";
import { googleWorkspaceAdapter } from "../lib/integrations/providers/google-workspace.ts";
const now = "2026-11-04T03:00:00Z";
const app: ConnectedApp = {
  id: "one",
  name: "Google",
  account: "owner@example.com",
  provider: "google_workspace",
  status: "connected",
  paused: false,
  readOnly: true,
  lastSyncedAt: now,
  syncing: false,
  error: null,
};
const row = (
  id: string,
  data: Record<string, unknown>,
  connectionId = "one",
): ImportedRow => ({
  id,
  connection_id: connectionId,
  object_type: "message",
  external_object_id: id,
  external_parent_id: "thread",
  canonical_data: {
    provider: "gmail",
    subject: "Question",
    labels: ["INBOX"],
    is_read: true,
    ...data,
  },
  external_updated_at: now,
  native_object_id: null,
});
test("email threads are deduplicated only within their account; deletes, trash, spam and unknown accounts stay out", () => {
  const second = { ...app, id: "two", account: "second@example.com" };
  const result = mapConnectedData(
    [app, second],
    [
      row("a", { is_read: false }),
      {
        ...row("b", { subject: "Latest" }),
        external_updated_at: "2026-11-04T03:01:00Z",
      },
      row("c", {}, "two"),
      row("d", { deleted: true }),
      row("e", { labels: ["TRASH"] }),
      row("f", {}, "unrelated"),
    ],
    now,
  );
  assert.equal(result.messages.length, 2);
  const thread = result.messages.find((m) => m.connectionId === "one")!;
  assert.equal(thread.subject, "Latest");
  assert.equal(thread.messageCount, 2);
  assert.equal(thread.unread, true);
  assert.match(thread.href!, /authuser=owner%40example.com/);
  assert.equal(JSON.stringify(result).includes("canonical_data"), false);
});
test("disconnected accounts and old mail are hidden; calendar cancellation and unsafe links are filtered", () => {
  assert.equal(
    mapConnectedData([{ ...app, status: "not_connected" }], [row("a", {})], now)
      .messages.length,
    0,
  );
  assert.equal(
    mapConnectedData(
      [app],
      [{ ...row("a", {}), external_updated_at: "2025-01-01T00:00:00Z" }],
      now,
    ).messages.length,
    0,
  );
  const event = {
    ...row("event", {
      title: "Visit",
      start_at: "2026-11-05T15:00:00Z",
      end_at: "2026-11-05T16:00:00Z",
      html_url: "javascript:alert(1)",
    }),
    object_type: "appointment",
  };
  assert.equal(
    mapConnectedData([app], [event], now).appointments[0].href,
    null,
  );
  assert.equal(
    mapConnectedData(
      [app],
      [
        {
          ...event,
          canonical_data: { ...event.canonical_data, status: "cancelled" },
        },
      ],
      now,
    ).appointments.length,
    0,
  );
});
test("read-only OAuth requests no send, contacts or calendar write grants, with a distinct signed PKCE attempt", () => {
  const before = process.env.SECRETS_ENCRYPTION_KEY;
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");
  try {
    const url = new URL(
      buildWorkspaceAuthorizationUrl(
        "google_workspace",
        { clientId: "fixture", clientSecret: "fixture" },
        "connection",
        undefined,
        { attemptId: "attempt", challenge: "challenge", readOnly: true },
      ),
    );
    assert.deepEqual(url.searchParams.get("scope")?.split(" "), [
      ...GOOGLE_WORKSPACE_READ_SCOPES,
    ]);
    const state = verifyWorkspaceOAuthState(url.searchParams.get("state")!);
    assert.equal(state?.readOnlyAttemptId, "attempt");
    assert.equal(state?.activationAttemptId, undefined);
    assert.equal(url.searchParams.get("include_granted_scopes"), "false");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  } finally {
    if (before === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = before;
  }
});
test("read-only connections cannot enqueue inquiries even if stale activation flags are enabled, and refuse every push", async () => {
  const config = {
    workspace_view_only: true,
    conversation_intake_enabled: true,
    conversation_intake_enabled_at: "2026-01-01T00:00:00Z",
  };
  assert.equal(
    inboxInquiry(
      {
        objectType: "message",
        externalId: "id",
        updatedAt: now,
        data: {
          inbound: true,
          automated: false,
          has_attachments: false,
          sender: "customer@example.com",
          body: "Book me",
        },
        source: {},
      },
      config,
      "live",
      Date.parse(now),
    ),
    null,
  );
  for (const type of ["message", "appointment", "customer", "lead"])
    assert.equal(allowsConnectorWork(config, "push", type), false);
  assert.equal(allowsConnectorWork(config, "pull", "customer"), false);
  assert.equal(allowsConnectorWork(config, "pull", "message"), true);
  await assert.rejects(
    async () =>
      googleWorkspaceAdapter.pushRecord!(
        {
          connectionId: "c",
          partnerId: "p",
          clientId: "b",
          config: {},
          credentials: {
            clientId: "x",
            clientSecret: "x",
            refreshToken: "x",
            accessMode: "read_only",
          },
        },
        {
          objectType: "appointment",
          operation: "create",
          nativeObjectId: "n",
          data: {},
          idempotencyKey: "key",
        },
      ),
    /read-only/,
  );
});
