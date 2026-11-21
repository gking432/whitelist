import assert from "node:assert/strict";
import test from "node:test";

import { fallbackSupportTriage } from "../lib/support/routing.ts";

const healthy = {
  failingConnections: 0,
  recentFailedRuns: 0,
  recentSuccessfulRuns: 4,
  latestError: null,
};

test("client issues always route to their partner first", () => {
  const result = fallbackSupportTriage({
    origin: "client",
    title: "The CRM is broken",
    description: "A lead failed to sync.",
    health: { ...healthy, recentFailedRuns: 1 },
  });
  assert.equal(result.recommendedRoute, "partner");
  assert.equal(result.category, "bug");
});

test("partner connector requests recommend guarded Codex work", () => {
  const result = fallbackSupportTriage({
    origin: "partner",
    title: "Connect FieldEdge",
    description: "We need a new connector for a client API.",
    health: healthy,
  });
  assert.equal(result.category, "integration_request");
  assert.equal(result.recommendedRoute, "codex");
});

test("billing and security remain owner decisions", () => {
  for (const title of ["Billing refund needed", "Possible security breach"]) {
    const result = fallbackSupportTriage({
      origin: "partner",
      title,
      description: title,
      health: healthy,
    });
    assert.equal(result.recommendedRoute, "owner");
  }
});

test("health failures promote unknown requests to incidents", () => {
  const result = fallbackSupportTriage({
    origin: "partner",
    title: "Something seems off",
    description: "Please investigate this account.",
    health: { ...healthy, failingConnections: 2, recentFailedRuns: 4 },
  });
  assert.equal(result.category, "incident");
  assert.equal(result.priority, "important");
  assert.equal(result.recommendedRoute, "platform");
});

test("an ordinary support request is not mislabeled as a feature request", () => {
  const result = fallbackSupportTriage({
    origin: "client",
    title: "Support request verification",
    description: "Please check that this reaches the right queue.",
    health: healthy,
  });
  assert.equal(result.category, "other");
  assert.equal(result.recommendedRoute, "partner");
});
