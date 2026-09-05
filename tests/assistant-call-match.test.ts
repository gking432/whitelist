import assert from "node:assert/strict";
import test from "node:test";

import { resolveAssistantCallMatchStatus } from "../lib/assistant/call-match.ts";

test("assistant reports a database-matched caller without resolver metadata", () => {
  assert.equal(
    resolveAssistantCallMatchStatus({
      resolverStatus: null,
      matchedContactId: "contact-1",
    }),
    "matched",
  );
});

test("assistant preserves explicit newly-created caller status", () => {
  assert.equal(
    resolveAssistantCallMatchStatus({
      resolverStatus: "created",
      matchedContactId: "contact-1",
    }),
    "created",
  );
});
