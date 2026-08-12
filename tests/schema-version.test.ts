import assert from "node:assert/strict";
import test from "node:test";

import {
  EXPECTED_SCHEMA_VERSION,
  schemaVersionIsCompatible,
} from "../lib/ops/schema-version.ts";

test("schema compatibility accepts the required or a newer migration", () => {
  assert.equal(
    schemaVersionIsCompatible(EXPECTED_SCHEMA_VERSION),
    true,
  );
  assert.equal(
    schemaVersionIsCompatible("20260813000000_future_additive_release"),
    true,
  );
});

test("schema compatibility rejects missing, malformed, or stale markers", () => {
  assert.equal(schemaVersionIsCompatible(null), false);
  assert.equal(schemaVersionIsCompatible("not-a-migration"), false);
  assert.equal(
    schemaVersionIsCompatible("20260812040000_provider_live_pilots"),
    false,
  );
});
