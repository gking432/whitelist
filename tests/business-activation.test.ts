import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activationStatus,
  freshCheck,
  slotFitsActivation,
  workspacePermissions,
} from "../lib/activation/rules.ts";
import {
  automatedMail,
  emailAddress,
  gmailPlainText,
  inboxInquiry,
} from "../lib/integrations/providers/inbox-message.ts";
import type { ActivationPlan } from "../lib/activation/types.ts";
import type { CanonicalRecord } from "../lib/integrations/connectors/types.ts";
import {
  buildWorkspaceAuthorizationUrl,
  verifyWorkspaceOAuthState,
  exchangeWorkspaceCode,
} from "../lib/integrations/providers/workspace-oauth.ts";

test("activation OAuth carries a signed attempt and PKCE through both providers", async () => {
  const previous = process.env.SECRETS_ENCRYPTION_KEY,
    original = globalThis.fetch;
  process.env.SECRETS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  try {
    for (const provider of ["google_workspace", "microsoft_365"] as const) {
      const url = new URL(
        buildWorkspaceAuthorizationUrl(
          provider,
          { clientId: "fixture", clientSecret: "fixture" },
          "connection",
          undefined,
          { attemptId: "attempt", challenge: "fixture-challenge" },
        ),
      );
      const state = url.searchParams.get("state")!;
      assert.equal(
        verifyWorkspaceOAuthState(state)?.activationAttemptId,
        "attempt",
      );
      assert.equal(verifyWorkspaceOAuthState(state + "tampered"), null);
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("code_challenge"), "fixture-challenge");
      globalThis.fetch = async (_input, init) => {
        assert.equal(
          new URLSearchParams(String(init?.body)).get("code_verifier"),
          "fixture-verifier",
        );
        return Response.json({
          refresh_token: "fixture-refresh",
          scope: "Mail.Read Mail.Send",
        });
      };
      assert.equal(
        (
          await exchangeWorkspaceCode(
            provider,
            { clientId: "fixture", clientSecret: "fixture" },
            "fixture-code",
            "fixture-verifier",
          )
        ).ok,
        true,
      );
    }
  } finally {
    globalThis.fetch = original;
    if (previous === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = previous;
  }
});

const plan: ActivationPlan = {
  partner_id: "p",
  client_id: "c",
  revision: 1,
  status: "active",
  inquiries: true,
  bookings: true,
  website: true,
  email: true,
  instagram: false,
  sms: false,
  workspace_provider: "google_workspace",
  workspace_connection_id: "conn",
  updated_at: "2026-10-08T12:00:00Z",
  booking_start_hour: 9,
  booking_end_hour: 17,
  booking_minutes: 60,
  booking_weekdays: [1, 2, 3, 4, 5],
  timezone: "America/Chicago",
};
test("activation never equates account authorization or an empty checklist with running", () => {
  const checks = [
    { key: "mail", label: "Mail", ready: true, detail: "checked" },
    { key: "worker", label: "Worker", ready: false, detail: "missing" },
  ];
  assert.equal(activationStatus(null, checks), "not_started");
  assert.equal(activationStatus(plan, checks), "needs_attention");
  assert.equal(activationStatus(plan, []), "needs_attention");
  assert.equal(
    activationStatus({ ...plan, status: "paused" }, checks),
    "paused",
  );
  assert.equal(
    activationStatus(
      plan,
      checks.map((c) => ({ ...c, ready: true })),
    ),
    "running",
  );
});
test("partial consent cannot pass email and calendar readiness", () => {
  assert.deepEqual(
    workspacePermissions("google_workspace", "openid email profile"),
    { email: false, calendar: false },
  );
  assert.equal(
    workspacePermissions(
      "google_workspace",
      "https://www.googleapis.com/auth/gmail.readonly",
    ).email,
    false,
  );
  assert.equal(
    workspacePermissions(
      "google_workspace",
      "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar",
    ).email,
    true,
  );
  assert.deepEqual(
    workspacePermissions(
      "microsoft_365",
      "Mail.Read Mail.Send Calendars.ReadWrite",
    ),
    { email: true, calendar: true },
  );
  assert.equal(
    workspacePermissions("microsoft_365", "Mail.ReadBasic Mail.Send").email,
    false,
  );
});
test("stale or future provider checks need attention", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  assert.equal(freshCheck("2026-10-08T11:00:00Z", now), true);
  for (const value of [
    null,
    "bad",
    "2026-10-07T11:00:00Z",
    "2026-10-08T12:05:00Z",
  ])
    assert.equal(freshCheck(value, now), false);
});
test("calendar choices include weekends only when selected and invalidate changed booking rules", () => {
  assert.equal(
    slotFitsActivation(plan, "2026-10-09T14:00:00Z", "2026-10-09T15:00:00Z"),
    true,
  );
  assert.equal(
    slotFitsActivation(plan, "2026-10-10T14:00:00Z", "2026-10-10T15:00:00Z"),
    false,
  );
  assert.equal(
    slotFitsActivation(
      { ...plan, booking_weekdays: [6] },
      "2026-10-10T14:00:00Z",
      "2026-10-10T15:00:00Z",
    ),
    true,
  );
  assert.equal(
    slotFitsActivation(
      { ...plan, booking_start_hour: 10 },
      "2026-10-09T14:00:00Z",
      "2026-10-09T15:00:00Z",
    ),
    false,
  );
  assert.equal(
    slotFitsActivation(
      { ...plan, booking_minutes: 30 },
      "2026-10-09T14:00:00Z",
      "2026-10-09T15:00:00Z",
    ),
    false,
  );
});
test("mail intake excludes history, self-mail, previews, lists, attachments and paused channels", () => {
  const now = Date.parse("2026-10-08T12:00:00Z");
  const config = {
    conversation_intake_enabled: true,
    conversation_intake_enabled_at: "2026-10-08T11:00:00Z",
    activation_account_email: "owner@example.com",
  };
  const record: CanonicalRecord = {
    objectType: "message",
    externalId: "m1",
    updatedAt: "2026-10-08T11:30:00Z",
    data: {
      sender: "customer@example.com",
      body: "Do you have appointments?",
      inbound: true,
      automated: false,
      has_attachments: false,
    },
    source: {},
  };
  assert.equal(
    inboxInquiry(record, config, "live", now)?.sender,
    "customer@example.com",
  );
  for (const patch of [
    { inbound: false },
    { automated: true },
    { has_attachments: true },
    { body: null, preview: "snippet" },
    { sender: "owner@example.com" },
    { sender: "a@example.com,b@example.com" },
  ])
    assert.equal(
      inboxInquiry(
        { ...record, data: { ...record.data, ...patch } },
        config,
        "live",
        now,
      ),
      null,
    );
  assert.equal(
    inboxInquiry(
      { ...record, updatedAt: "2026-10-08T10:00:00Z" },
      config,
      "live",
      now,
    ),
    null,
  );
  assert.equal(
    inboxInquiry({ ...record, deleted: true }, config, "live", now),
    null,
  );
  assert.equal(
    inboxInquiry(
      record,
      { ...config, conversation_intake_enabled: false },
      "live",
      now,
    ),
    null,
  );
  assert.equal(inboxInquiry(record, config, "paused", now), null);
});
test("MIME parsing takes bounded plain text and rejects attachment bodies", () => {
  const text = {
    mimeType: "text/plain",
    body: { data: Buffer.from("Can I book Friday?").toString("base64url") },
  };
  assert.equal(
    gmailPlainText({
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: "ignored" } }, text],
    }),
    "Can I book Friday?",
  );
  assert.equal(gmailPlainText({ ...text, filename: "note.txt" }), "");
  assert.equal(
    gmailPlainText({
      mimeType: "text/plain",
      body: { data: Buffer.from("x".repeat(7000)).toString("base64url") },
    }).length,
    6000,
  );
  assert.equal(
    emailAddress("Customer Name <Customer@example.com>"),
    "customer@example.com",
  );
  assert.equal(
    emailAddress("customer@example.com\r\nBcc:other@example.com"),
    null,
  );
  assert.equal(
    automatedMail({ "auto-submitted": "auto-replied" }, "a@example.com"),
    true,
  );
  assert.equal(
    automatedMail(
      { "list-unsubscribe": "<https://example.com>" },
      "a@example.com",
    ),
    true,
  );
  assert.equal(automatedMail({}, "noreply@example.com"), true);
  assert.equal(automatedMail({}, "customer@example.com"), false);
});
