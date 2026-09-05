import assert from "node:assert/strict";
import test from "node:test";

import { switchLocalDevUser } from "../lib/auth/dev-login.ts";

test("local preview login clears the current identity before switching roles", async () => {
  const calls: string[] = [];
  const client = {
    auth: {
      async signOut(options: { scope: "local" }) {
        calls.push(`sign-out:${options.scope}`);
      },
      async signInWithPassword(credentials: { email: string; password: string }) {
        calls.push(`sign-in:${credentials.email}:${credentials.password}`);
        return { error: null };
      },
    },
  };

  const result = await switchLocalDevUser(client, {
    email: "platform@northstar.test",
    password: "preview-password",
  });

  assert.deepEqual(calls, [
    "sign-out:local",
    "sign-in:platform@northstar.test:preview-password",
  ]);
  assert.equal(result.error, null);
});
