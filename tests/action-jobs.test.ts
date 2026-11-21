import assert from "node:assert/strict";
import test from "node:test";

import {
  actionJobOutcomeFields,
  isRetryableJobStatus,
} from "../lib/jobs/outcome.ts";

test("action jobs retain non-error delivery outcomes", () => {
  assert.deepEqual(
    actionJobOutcomeFields({
      status: "skipped",
      detail: "Connect a live SMS provider before sending.",
    }),
    {
      status: "skipped",
      outcome_detail: "Connect a live SMS provider before sending.",
      last_error: null,
    },
  );
});

test("failed action outcomes remain visible as errors", () => {
  assert.deepEqual(
    actionJobOutcomeFields({
      status: "failed",
      detail: "Provider rejected the message.",
    }),
    {
      status: "failed",
      outcome_detail: "Provider rejected the message.",
      last_error: "Provider rejected the message.",
    },
  );
});

test("only undelivered terminal outcomes are retryable", () => {
  assert.equal(isRetryableJobStatus("failed"), true);
  assert.equal(isRetryableJobStatus("dry_run"), true);
  assert.equal(isRetryableJobStatus("skipped"), true);
  assert.equal(isRetryableJobStatus("succeeded"), false);
});
