import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  verifyInstagramSignature,
  instagramReplyWindowOpen,
} from "../lib/integrations/providers/instagram-messaging.ts";
import { authorizedActionPayload } from "../lib/jobs/execution-state.ts";
test("Instagram signatures reject modified bodies and malformed digests", () => {
  const body = '{"object":"instagram"}',
    secret = "fixture-app-secret";
  const signature =
    "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyInstagramSignature(body, signature, secret), true);
  assert.equal(verifyInstagramSignature(body + " ", signature, secret), false);
  assert.equal(verifyInstagramSignature(body, "sha256=bad", secret), false);
  assert.equal(
    verifyInstagramSignature(body, signature, "wrong-secret"),
    false,
  );
});
test("Instagram reply windows use source event time, rejecting old and future events", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(instagramReplyWindowOpen("2026-10-08T11:00:00Z", now), true);
  assert.equal(instagramReplyWindowOpen("2026-10-07T11:59:59Z", now), false);
  assert.equal(instagramReplyWindowOpen("2026-10-09T12:00:00Z", now), false);
  assert.equal(instagramReplyWindowOpen(undefined, now), false);
});
test("conversation sends require approved same-tenant content; unknown kinds cannot become SMS", () => {
  const job = {
    approval_id: "approval",
    partner_id: "partner",
    client_id: "client",
    kind: "conversation.send",
  };
  const approval = {
    id: "approval",
    partner_id: "partner",
    client_id: "client",
    status: "approved",
    type: "customer_message",
    resolved_content: "Approved text",
    proposed_payload: {
      channel: "website_chat",
      conversation_id: "conversation",
    },
  };
  assert.equal(authorizedActionPayload(job, approval)?.body, "Approved text");
  assert.equal(
    authorizedActionPayload(job, { ...approval, status: "pending" }),
    null,
  );
  assert.equal(
    authorizedActionPayload(job, { ...approval, client_id: "other" }),
    null,
  );
  assert.equal(
    authorizedActionPayload(
      { ...job, kind: "madeup" },
      { ...approval, proposed_payload: { channel: "sms" } },
    ),
    null,
  );
});
