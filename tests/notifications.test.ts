import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationDeliveryText,
  shouldRetryNotificationDelivery,
  unreadNotificationCount,
} from "../lib/notifications/client.ts";

test("unread count excludes resolved and previously read notifications", () => {
  const count = unreadNotificationCount(
    [
      { id: "open", resolved_at: null },
      { id: "read", resolved_at: null },
      { id: "resolved", resolved_at: "2026-07-25T12:00:00.000Z" },
    ],
    new Set(["read"]),
  );

  assert.equal(count, 1);
});

test("delivery text includes the action URL and respects channel limits", () => {
  const message = notificationDeliveryText({
    title: "Urgent lead",
    body: "A customer needs a callback.",
    actionUrl: "https://app.example.com/client/notifications",
    maxLength: 48,
  });

  assert.equal(message.length, 48);
  assert.match(message, /\.\.\.$/);
});

test("failed notification deliveries wait before retrying", () => {
  const now = new Date("2026-07-25T12:10:00.000Z");

  assert.equal(
    shouldRetryNotificationDelivery(
      {
        status: "failed",
        attempt_count: 1,
        last_attempt_at: "2026-07-25T12:08:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    shouldRetryNotificationDelivery(
      {
        status: "failed",
        attempt_count: 1,
        last_attempt_at: "2026-07-25T12:00:00.000Z",
      },
      now,
    ),
    true,
  );
});
