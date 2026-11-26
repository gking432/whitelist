import assert from "node:assert/strict";
import test from "node:test";

import { getLocalDevLoginEmail } from "../lib/env.ts";

test("local role login routes desktop assistant sessions to the client user", () => {
  const previous = process.env.DEV_AUTO_LOGIN_EMAIL;
  delete process.env.DEV_AUTO_LOGIN_EMAIL;

  try {
    assert.equal(
      getLocalDevLoginEmail("/desktop/assistant"),
      "client@northstar.test",
    );
    assert.equal(getLocalDevLoginEmail("/client/crm"), "client@northstar.test");
    assert.equal(getLocalDevLoginEmail("/partner"), "partner@northstar.test");
    assert.equal(getLocalDevLoginEmail("/control"), "platform@northstar.test");
  } finally {
    if (previous === undefined) delete process.env.DEV_AUTO_LOGIN_EMAIL;
    else process.env.DEV_AUTO_LOGIN_EMAIL = previous;
  }
});

test("prototype destinations with a view parameter use the platform test identity", () => {
  const previous = process.env.DEV_AUTO_LOGIN_EMAIL;
  delete process.env.DEV_AUTO_LOGIN_EMAIL;
  try {
    assert.equal(
      getLocalDevLoginEmail("/dev/prototype"),
      "platform@northstar.test",
    );
    assert.equal(
      getLocalDevLoginEmail("/dev/prototype?view=mobile"),
      "platform@northstar.test",
    );
    assert.equal(
      getLocalDevLoginEmail("/dev/prototype?view=mobile#preview"),
      "platform@northstar.test",
    );
    assert.equal(
      getLocalDevLoginEmail("/dev/prototype-other"),
      "partner@northstar.test",
    );
    process.env.DEV_AUTO_LOGIN_EMAIL = "custom@test.example";
    assert.equal(
      getLocalDevLoginEmail("/dev/prototype?view=mobile"),
      "custom@test.example",
    );
  } finally {
    if (previous === undefined) delete process.env.DEV_AUTO_LOGIN_EMAIL;
    else process.env.DEV_AUTO_LOGIN_EMAIL = previous;
  }
});
