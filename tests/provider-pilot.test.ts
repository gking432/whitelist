import assert from "node:assert/strict";
import test from "node:test";

import { providerPilotReadiness } from "../lib/control/provider-pilot.ts";

const complete = {
  connectionStatus: "connected",
  credentialStatus: "configured",
  runtimeMode: "live",
  supportsInbound: true,
  supportsOutbound: true,
  inboundEventId: "inbound-event",
  outboundEventId: "outbound-event",
  readEvidence: "Read a real customer from the provider account.",
  retryEvidence: "Retried a failed request without creating a duplicate.",
  revocationEvidence: "Revoked the credential and observed a safe failure.",
};

test("provider pilot requires every applicable real-account proof", () => {
  const result = providerPilotReadiness(complete);
  assert.equal(result.ready, true);
  assert.ok(result.proofs.every((proof) => proof.complete));

  for (const key of [
    "inboundEventId",
    "outboundEventId",
    "readEvidence",
    "retryEvidence",
    "revocationEvidence",
  ] as const) {
    const incomplete = providerPilotReadiness({ ...complete, [key]: null });
    assert.equal(incomplete.ready, false, key);
  }
});

test("provider pilot rejects sandbox or unverified credentials", () => {
  assert.equal(
    providerPilotReadiness({ ...complete, runtimeMode: "sandbox" }).ready,
    false,
  );
  assert.equal(
    providerPilotReadiness({ ...complete, credentialStatus: "invalid" }).ready,
    false,
  );
  assert.equal(
    providerPilotReadiness({ ...complete, connectionStatus: "failing" }).ready,
    false,
  );
});

test("provider pilot only requires directions supported by the connector", () => {
  const result = providerPilotReadiness({
    ...complete,
    supportsInbound: false,
    supportsOutbound: false,
    inboundEventId: null,
    outboundEventId: null,
  });
  assert.equal(result.ready, true);
  assert.equal(result.proofs.some((proof) => proof.key === "inbound"), false);
  assert.equal(result.proofs.some((proof) => proof.key === "outbound"), false);
});
