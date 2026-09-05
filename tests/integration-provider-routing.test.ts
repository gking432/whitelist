import assert from "node:assert/strict";
import test from "node:test";

import {
  isSelfServiceConnectionProvider,
  isTokenInboundProvider,
} from "../lib/integrations/types.ts";

test("only platform-owned endpoints use the generic connection creator", () => {
  for (const provider of [
    "generic_inbound_webhook",
    "generic_outbound_webhook",
    "northstar_web_chat",
  ]) {
    assert.equal(isSelfServiceConnectionProvider(provider), true, provider);
  }

  for (const provider of ["twilio", "hubspot", "resend", "jobber"]) {
    assert.equal(isSelfServiceConnectionProvider(provider), false, provider);
  }
});

test("only generic intake and web chat receive webhook tokens", () => {
  assert.equal(isTokenInboundProvider("generic_inbound_webhook"), true);
  assert.equal(isTokenInboundProvider("northstar_web_chat"), true);
  assert.equal(isTokenInboundProvider("generic_outbound_webhook"), false);
  assert.equal(isTokenInboundProvider("twilio"), false);
});
