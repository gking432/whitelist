import assert from "node:assert/strict";
import test from "node:test";
import { hasUnambiguousSlotChoice } from "../lib/conversations/slot-choice.ts";

const slots = [
  {
    start_iso: "2026-10-15T19:00:00Z",
    end_iso: "2026-10-15T20:00:00Z",
    label: "Thursday 2 PM",
  },
  {
    start_iso: "2026-10-15T21:30:00Z",
    end_iso: "2026-10-15T22:30:00Z",
    label: "Thursday 4:30 PM",
  },
  {
    start_iso: "2026-10-16T21:30:00Z",
    end_iso: "2026-10-16T22:30:00Z",
    label: "Friday 4:30 PM",
  },
];
const choose = (text: string, selected: number | null) =>
  hasUnambiguousSlotChoice(text, slots, selected, "America/Chicago");
test("explicit option and ordinal identify only the chosen offered slot", () => {
  assert.equal(choose("Please book option 2", 2), true);
  assert.equal(choose("the first one please", 1), true);
  assert.equal(choose("1 please", 1), true);
  assert.equal(choose("option 2", 1), false);
  assert.equal(choose("option 2 at 2 pm", 2), false);
  assert.equal(choose("option 2 on Friday", 2), false);
  assert.equal(choose("option 2 on Thursday at 4:30", 2), true);
});
test("a vague yes, negated choice, or multiple choices cannot book", () => {
  for (const text of [
    "yes",
    "sounds good",
    "any time",
    "not option 1",
    "option 1 or option 2",
  ])
    assert.equal(choose(text, 1), false);
  assert.equal(choose("option 4", 4), false);
});
test("clock time must uniquely identify an offered appointment", () => {
  assert.equal(choose("Please book at 2 pm", 1), true);
  assert.equal(choose("2 am please", 1), false);
  assert.equal(choose("4:30 please", 2), false);
  assert.equal(choose("Thursday at 4:30", 2), true);
  assert.equal(choose("Friday at 4:30 pm", 3), true);
  assert.equal(choose("Thursday at 4:30 am", 2), false);
});
