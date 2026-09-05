import assert from "node:assert/strict";
import test from "node:test";

import { getLocalDevLoginEmail } from "../lib/env.ts";

test("local role login routes desktop assistant sessions to the client user", () => {
  const previous = process.env.DEV_AUTO_LOGIN_EMAIL;
  delete process.env.DEV_AUTO_LOGIN_EMAIL;

  try {
    assert.equal(getLocalDevLoginEmail("/desktop/assistant"), "client@northstar.test");
    assert.equal(getLocalDevLoginEmail("/client/crm"), "client@northstar.test");
    assert.equal(getLocalDevLoginEmail("/partner"), "partner@northstar.test");
    assert.equal(getLocalDevLoginEmail("/control"), "platform@northstar.test");
  } finally {
    if (previous === undefined) delete process.env.DEV_AUTO_LOGIN_EMAIL;
    else process.env.DEV_AUTO_LOGIN_EMAIL = previous;
  }
});
