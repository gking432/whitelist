import { test } from "node:test";
import assert from "node:assert/strict";
import { googleWorkspaceAdapter } from "../lib/integrations/providers/google-workspace.ts";
import { microsoft365Adapter } from "../lib/integrations/providers/microsoft-365.ts";
import { inboxInquiry } from "../lib/integrations/providers/inbox-message.ts";

const credentials = {
  clientId: "fixture",
  clientSecret: "fixture",
  refreshToken: "fixture",
  scope: "Mail.Read Mail.Send",
};
const context = {
  connectionId: "fixture",
  partnerId: "fixture",
  clientId: "fixture",
  credentials,
  config: {
    conversation_intake_enabled: true,
    conversation_intake_enabled_at: new Date(
      Date.now() - 3600000,
    ).toISOString(),
  },
};

test("Gmail reads bodies only for newly enabled inbound mail, never historical or unselected mail", async () => {
  const original = globalThis.fetch,
    calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(String(url));
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ access_token: "fixture" });
    if (url.pathname.endsWith("/profile"))
      return Response.json({ historyId: "10" });
    if (url.pathname.endsWith("/messages"))
      return Response.json({
        messages: [{ id: "new" }, { id: "old" }, { id: "sent" }],
      });
    const id = url.pathname.split("/").pop()!;
    assert.ok(["new", "old", "sent"].includes(id));
    return Response.json({
      id,
      threadId: `thread-${id}`,
      internalDate: String(id === "old" ? Date.now() - 86400000 : Date.now()),
      labelIds: id === "sent" ? ["SENT"] : ["INBOX"],
      payload: {
        mimeType: "text/plain",
        headers: [{ name: "From", value: "customer@example.com" }],
        ...(url.searchParams.get("format") === "full"
          ? {
              body: {
                data: Buffer.from("I would like an appointment.").toString(
                  "base64url",
                ),
              },
            }
          : {}),
      },
    });
  };
  try {
    const page = await googleWorkspaceAdapter.pullPage!(
      context,
      "message",
      null,
    );
    assert.equal(page.records.length, 3);
    assert.equal(
      inboxInquiry(page.records[0], context.config, "live")?.message,
      "I would like an appointment.",
    );
    assert.equal(inboxInquiry(page.records[1], context.config, "live"), null);
    assert.equal(inboxInquiry(page.records[2], context.config, "live"), null);
    assert.equal(calls.filter((u) => u.includes("format=full")).length, 1);
    calls.length = 0;
    await googleWorkspaceAdapter.pullPage!(
      { ...context, config: {} },
      "message",
      null,
    );
    assert.equal(calls.filter((u) => u.includes("format=full")).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("Microsoft hydrates a new message from an older metadata-only delta cursor", async () => {
  const original = globalThis.fetch,
    calls: string[] = [];
  const legacy =
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=fixture";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("/token"))
      return Response.json({ access_token: "fixture" });
    if (url === legacy)
      return Response.json({
        value: [
          { id: "new", receivedDateTime: new Date().toISOString() },
          { id: "old", receivedDateTime: "2020-01-01T00:00:00Z" },
          { id: "deleted", "@removed": { reason: "deleted" } },
        ],
        "@odata.deltaLink": legacy,
      });
    assert.ok(url.includes("/me/messages/new?"));
    assert.equal(
      (init?.headers as Record<string, string>).Prefer,
      'outlook.body-content-type="text"',
    );
    return Response.json({
      id: "new",
      conversationId: "thread",
      receivedDateTime: new Date().toISOString(),
      from: { emailAddress: { address: "customer@example.com" } },
      body: { contentType: "text", content: "Do you have any openings?" },
      isDraft: false,
      hasAttachments: false,
      internetMessageHeaders: [],
    });
  };
  try {
    const page = await microsoft365Adapter.pullPage!(context, "message", {
      deltaLink: legacy,
    });
    assert.equal(
      inboxInquiry(page.records[0], context.config, "live")?.message,
      "Do you have any openings?",
    );
    assert.equal(page.records[2].deleted, true);
    assert.equal(calls.filter((u) => u.includes("/me/messages/")).length, 1);
  } finally {
    globalThis.fetch = original;
  }
});
