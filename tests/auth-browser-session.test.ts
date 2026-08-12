import assert from "node:assert/strict";
import test from "node:test";

import { sessionTokensFromHash } from "../lib/auth/browser-session.ts";

test("invite fragments yield the access and refresh tokens", () => {
  assert.deepEqual(
    sessionTokensFromHash("#access_token=access-123&refresh_token=refresh-456&type=invite"),
    { accessToken: "access-123", refreshToken: "refresh-456" },
  );
});

test("incomplete auth fragments are rejected", () => {
  assert.equal(sessionTokensFromHash("#type=invite"), null);
  assert.equal(sessionTokensFromHash(""), null);
});
