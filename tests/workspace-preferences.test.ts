import assert from "node:assert/strict";
import test from "node:test";
import type { DailyWorkSection } from "../lib/business/focus-brief.ts";
import { defaultWorkspacePreferences, orderDailySections, parseWorkspacePreferences, recommendWorkspaceFocus } from "../lib/business/workspace-preferences.ts";

const section = (key: string, count = 1): DailyWorkSection => ({ key, title: key, remaining: 0,
  rows: Array.from({ length: count }, (_, i) => ({ key: `${key}:${i}`, title: `Actual ${key} record`, detail: "Recorded source", kind: "attention", label: "Review" })) });
const keys = (sections: DailyWorkSection[]) => sections.map((item) => item.key);

test("defaults are independent values and parsed preferences require bounded complete owner settings", () => {
  const a = defaultWorkspacePreferences(), b = defaultWorkspacePreferences(); a.order.reverse(); a.pinned.push("money");
  assert.deepEqual(b, { revision: 0, displayName: null, order: ["messages", "appointments", "todo", "money"], pinned: [] });
  const saved = { ...b, revision: 4, displayName: "My work", pinned: ["money"] };
  assert.deepEqual(parseWorkspacePreferences(saved), saved);
  for (const bad of [{ ...saved, revision: -1 }, { ...saved, revision: 1.5 }, { ...saved, displayName: " " }, { ...saved, displayName: " Leading" }, { ...saved, displayName: "x".repeat(61) }, { ...saved, displayName: "Name\nsecret" }, { ...saved, pinned: ["money", "money"] }, { ...saved, order: ["messages", "messages", "todo", "money"] }, { ...saved, order: ["messages"] }, { ...saved, pinned: ["customers"] }, { ...saved, automatic: true }]) assert.equal(parseWorkspacePreferences(bad), null);
  assert.equal(parseWorkspacePreferences({ ...b, displayName: "x".repeat(60) })?.displayName?.length, 60);
});
test("urgent decisions and money-source review stay before all manual module preferences", () => {
  const sections = [section("invoices"), section("todo"), section("money-source-review"), section("messages"), section("attention"), section("appointments")];
  const prefs = { ...defaultWorkspacePreferences(), order: ["money", "todo", "appointments", "messages"] as const, pinned: ["todo"] as const };
  assert.deepEqual(keys(orderDailySections(sections, { ...prefs, order: [...prefs.order], pinned: [...prefs.pinned] })), ["attention", "money-source-review", "todo", "invoices", "appointments", "messages"]);
  assert.equal(orderDailySections(sections)[0], sections[4], "Existing urgent source rows are preserved by reference.");
});
test("pins follow explicit order while equivalent source sections retain their existing relative order", () => {
  const sections = [section("connected-invoices"), section("intake"), section("invoices"), section("messages"), section("todo"), section("appointments")];
  const prefs = { ...defaultWorkspacePreferences(), order: ["appointments", "money", "messages", "todo"] as const, pinned: ["messages", "money"] as const };
  assert.deepEqual(keys(orderDailySections(sections, { ...prefs, order: [...prefs.order], pinned: [...prefs.pinned] })), ["connected-invoices", "invoices", "intake", "messages", "appointments", "todo"]);
  assert.deepEqual(keys(sections), ["connected-invoices", "intake", "invoices", "messages", "todo", "appointments"], "Input is not mutated.");
});
test("an empty workspace stays empty even with pins and unknown sections do not create filler", () => {
  assert.deepEqual(orderDailySections([], { ...defaultWorkspacePreferences(), pinned: ["money"] }), []);
  assert.deepEqual(orderDailySections([section("attention", 0), section("money-source-review", 0), section("messages", 0)]), []);
  assert.deepEqual(keys(orderDailySections([section("other"), section("messages")], null)), ["messages", "other"]);
});
test("recommendations require three distinct recorded days and actual relevant work", () => {
  assert.equal(recommendWorkspaceFocus([section("messages")], []), null);
  assert.equal(recommendWorkspaceFocus([section("messages")], [{ module: "messages", days: 2 }]), null);
  assert.equal(recommendWorkspaceFocus([], [{ module: "messages", days: 14 }]), null);
  assert.equal(recommendWorkspaceFocus([section("messages", 0)], [{ module: "messages", days: 5 }]), null);
  assert.equal(recommendWorkspaceFocus([section("intake")], [{ module: "messages", days: 3 }]), "messages");
  assert.equal(recommendWorkspaceFocus([section("appointments")], [{ module: "messages", days: 10 }, { module: "appointments", days: 4 }]), "appointments");
});
test("ties, duplicate day aggregates and malformed lookbacks cannot manufacture a focus suggestion", () => {
  const sections = [section("messages"), section("appointments"), section("invoices")];
  assert.equal(recommendWorkspaceFocus(sections, [{ module: "messages", days: 3 }, { module: "appointments", days: 3 }]), null);
  assert.equal(recommendWorkspaceFocus(sections, [{ module: "messages", days: 1 }, { module: "messages", days: 2 }]), null);
  for (const days of [-1, 3.5, 15, NaN, Infinity]) assert.equal(recommendWorkspaceFocus(sections, [{ module: "messages", days }]), null);
  assert.equal(recommendWorkspaceFocus(sections, [{ module: "money", days: 3 }, { module: "appointments", days: 4 }]), "appointments");
  assert.deepEqual(keys(orderDailySections(sections)), ["messages", "appointments", "invoices"], "Activity never changes the default ordering.");
});
