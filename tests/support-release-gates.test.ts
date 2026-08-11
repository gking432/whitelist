import assert from "node:assert/strict";
import test from "node:test";

import {
  codeRequestReadyForValidation,
  supportReleaseCanComplete,
} from "../lib/support/release-gates.ts";

test("support without code work can proceed to requester validation", () => {
  assert.equal(codeRequestReadyForValidation(null), true);
});

test("linked code work must be ready before requester validation", () => {
  for (const status of ["requested", "building", "testing", "blocked"]) {
    assert.equal(codeRequestReadyForValidation(status), false);
  }
  assert.equal(codeRequestReadyForValidation("ready"), true);
});

test("release completion requires requester approval and ready code work", () => {
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_approved",
      codeRequestStatus: "ready",
    }),
    true,
  );
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_validation",
      codeRequestStatus: "ready",
    }),
    false,
  );
  assert.equal(
    supportReleaseCanComplete({
      releaseStatus: "requester_approved",
      codeRequestStatus: "queued",
    }),
    false,
  );
});
