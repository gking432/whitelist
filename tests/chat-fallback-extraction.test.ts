import assert from "node:assert/strict";
import test from "node:test";

import { extractFallbackName } from "../lib/chat/fallback-extraction.ts";

test("fallback name extraction stops before contact-detail conjunctions", () => {
  assert.equal(
    extractFallbackName(
      "My name is Acceptance Test and my phone is 312-555-0199.",
    ),
    "Acceptance Test",
  );
});

test("fallback name extraction supports ordinary introductions", () => {
  assert.equal(extractFallbackName("Hi, I'm Jamie O'Neil."), "Jamie O'Neil");
  assert.equal(extractFallbackName("This is Morgan Lee at 123 Main St."), "Morgan Lee");
  assert.equal(extractFallbackName("The AC stopped working."), null);
});
