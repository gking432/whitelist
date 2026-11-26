import assert from "node:assert/strict";
import test from "node:test";

import { releaseId } from "../lib/ops/release-id.ts";

test("release id accepts provider and GitHub commit SHAs", () => {
  assert.equal(releaseId({ RENDER_GIT_COMMIT: "ABCDEF1234567" }), "abcdef1234567");
  assert.equal(releaseId({ GITHUB_SHA: "1234567" }), "1234567");
});

test("release id never exposes malformed environment values", () => {
  assert.equal(releaseId({ RELEASE_SHA: "release with spaces" }), null);
  assert.equal(releaseId({ RENDER_GIT_COMMIT: "" }), null);
});
