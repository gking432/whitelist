import assert from "node:assert/strict";
import test from "node:test";
import { aiBudgetLimit, aiReservation } from "../lib/ai/budget.ts";

test("AI reservations bound Unicode input, output and schema overhead without exposing text", () => {
  const result = aiReservation({ system: "guard", user: "private 客户", format: { type: "json_schema" }, maxTokens: 1024 });
  assert.ok(result.tokens > 4096 + 1024 + Buffer.byteLength("private 客户"));
  assert.match(result.promptHash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.notEqual(result.promptHash, aiReservation({ system: "changed", user: "private 客户", format: {}, maxTokens: 1024 }).promptHash);
});

test("daily AI limits are finite and bounded", () => {
  assert.equal(aiBudgetLimit("invalid"), 100000);
  assert.equal(aiBudgetLimit("0"), 1);
  assert.equal(aiBudgetLimit("999999999"), 10000000);
  assert.equal(aiBudgetLimit("15000"), 15000);
});
