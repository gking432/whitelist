import assert from "node:assert/strict";
import test from "node:test";
import { assistantPreferenceSummary, assistantStatusLabel } from "../components/personal-assistant/presentation.ts";

test("No and Skip never imply that the owner chose our assistant", () => {
  assert.equal(assistantPreferenceSummary({ answer: "unanswered", assistant: null }), "Not selected");
  assert.equal(assistantPreferenceSummary({ answer: "skipped", assistant: null }), "Skipped for now");
  assert.equal(assistantPreferenceSummary({ answer: "no", assistant: null }), "No personal assistant selected");
  assert.equal(assistantPreferenceSummary({ answer: "no", assistant: "workstation" }), "Workstation assistant (ours)");
});
test("external preference labels preserve the actual selected assistant", () => {
  assert.equal(assistantPreferenceSummary({ answer: "yes", assistant: "muse" }), "Muse");
  assert.equal(assistantPreferenceSummary({ answer: "yes", assistant: "chatgpt_dot" }), "ChatGPT Dot");
  assert.equal(assistantPreferenceSummary({ answer: "yes", assistant: "grok" }), "Grok");
  assert.equal(assistantPreferenceSummary({ answer: "yes", assistant: "other" }), "Another assistant");
});
test("setup and unavailable connection states cannot render as connected or ready to chat", () => {
  assert.equal(assistantStatusLabel("not_selected"), "Not selected");
  assert.equal(assistantStatusLabel("setup_needed"), "Setup needed");
  assert.equal(assistantStatusLabel("unavailable"), "Integration unavailable");
  for (const state of ["not_selected", "setup_needed", "unavailable"] as const) assert.doesNotMatch(assistantStatusLabel(state), /connected|ready|chat available/i);
});
