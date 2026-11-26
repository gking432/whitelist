import assert from "node:assert/strict";
import test from "node:test";

import {
  contrastColor,
  DEFAULT_BRAND_COLORS,
  isBrandColor,
  normalizeBrandColor,
} from "../lib/branding.ts";

test("brand colors accept complete six-digit hex values", () => {
  assert.equal(isBrandColor("#1E4735"), true);
  assert.equal(normalizeBrandColor("#1E4735", "#000000"), "#1e4735");
});

test("invalid brand colors fall back to the product defaults", () => {
  assert.equal(isBrandColor("#fff"), false);
  assert.equal(
    normalizeBrandColor("not-a-color", DEFAULT_BRAND_COLORS.primary),
    DEFAULT_BRAND_COLORS.primary,
  );
});

test("contrast color stays readable on light and dark brand colors", () => {
  assert.equal(contrastColor("#f4d35e"), "#191d1a");
  assert.equal(contrastColor("#12291d"), "#ffffff");
});
