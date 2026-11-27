import assert from "node:assert/strict";
import test from "node:test";
import { clearFirstOwnerDraftAfterProvision, FIRST_OWNER_DRAFT_TTL_MS, firstOwnerDraftErrors, firstOwnerDraftKey, firstOwnerErrorStep, newFirstOwnerDraft, parseFirstOwnerDraft, readFirstOwnerDraft, writeFirstOwnerDraft } from "../components/onboarding/first-owner-draft.ts";

const actor = "10000000-0000-4000-8000-000000000001", other = "10000000-0000-4000-8000-000000000002", key = "20000000-0000-4000-8000-000000000001", now = 1_800_000_000_000;
function memory() {
  const items = new Map<string, string>();
  return { items, getItem: (name: string) => items.get(name) ?? null, setItem: (name: string, value: string) => { items.set(name, value); }, removeItem: (name: string) => { items.delete(name); } };
}
test("new first-owner drafts contain no assumed business facts, and valid partial answers retain their request identity across refresh", () => {
  const storage = memory(), draft = newFirstOwnerDraft(actor, key, now);
  assert.deepEqual(draft.values, { name: "", description: "", timezone: "" });
  assert.equal(writeFirstOwnerDraft(storage, { ...draft, step: 1, values: { ...draft.values, name: "Owner supplied name" } }, now), true);
  const restored = readFirstOwnerDraft(storage, actor, now + 1000)!;
  assert.equal(restored.requestKey, key); assert.equal(restored.step, 1); assert.equal(restored.values.name, "Owner supplied name");
  assert.equal(readFirstOwnerDraft(storage, other, now), null);
  assert.equal(firstOwnerDraftKey("not-an-actor"), null);
});
test("draft parsing rejects another actor, expiry, future lifetime, unknown versions/fields and oversized or unsafe answers", () => {
  const draft = newFirstOwnerDraft(actor, key, now), parse = (value: unknown, at = now) => parseFirstOwnerDraft(JSON.stringify(value), actor, at);
  assert.equal(parse(draft)?.step, 0);
  for (const value of [
    { ...draft, scopeKey: other }, { ...draft, version: 2 }, { ...draft, extra: true }, { ...draft, requestKey: "bad" },
    { ...draft, step: 3 }, { ...draft, step: -1 }, { ...draft, expiresAt: now }, { ...draft, expiresAt: now + FIRST_OWNER_DRAFT_TTL_MS + 1 },
    { ...draft, values: { ...draft.values, name: "n".repeat(101) } }, { ...draft, values: { ...draft.values, description: "d".repeat(2001) } },
    { ...draft, values: { ...draft.values, timezone: "UTC\u0000" } }, { ...draft, values: { ...draft.values, extra: "private" } },
  ]) assert.equal(parse(value), null);
  assert.equal(parseFirstOwnerDraft("{bad", actor, now), null);
  assert.equal(parseFirstOwnerDraft(" ".repeat(4097), actor, now), null);
  const storage = memory(); storage.setItem(firstOwnerDraftKey(actor)!, JSON.stringify(draft));
  assert.equal(readFirstOwnerDraft(storage, actor, draft.expiresAt), null); assert.equal(storage.items.size, 0);
});
test("local persistence fails honestly and guarded provision completion clears only the confirmed actor's draft", () => {
  const storage = memory(); writeFirstOwnerDraft(storage, newFirstOwnerDraft(actor, key, now), now); writeFirstOwnerDraft(storage, newFirstOwnerDraft(other, key, now), now);
  clearFirstOwnerDraftAfterProvision(storage, actor); assert.equal(storage.items.size, 2);
  clearFirstOwnerDraftAfterProvision(storage, `${actor}:invalid`); assert.equal(storage.items.size, 2);
  clearFirstOwnerDraftAfterProvision(storage, `${actor}:${key}`);
  assert.equal(storage.getItem(firstOwnerDraftKey(actor)!), null); assert.notEqual(storage.getItem(firstOwnerDraftKey(other)!), null);
  const unavailable = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(writeFirstOwnerDraft(unavailable, newFirstOwnerDraft(actor, key, now), now), false);
  assert.equal(readFirstOwnerDraft(unavailable, actor, now), null);
  assert.doesNotThrow(() => clearFirstOwnerDraftAfterProvision(unavailable, `${actor}:${key}`));
});
test("question validation reuses real provision requirements and routes returned server field errors to their answer", () => {
  const draft = newFirstOwnerDraft(actor, key, now);
  assert.deepEqual(Object.keys(firstOwnerDraftErrors(draft)), ["name", "description", "timezone"]);
  assert.equal(firstOwnerErrorStep({ description: "Describe the business" }), 1); assert.equal(firstOwnerErrorStep({ timezone: "Invalid" }), 2);
  assert.equal(firstOwnerErrorStep({ key: "Reload" }), 0); assert.equal(firstOwnerErrorStep(undefined), null);
  assert.deepEqual(firstOwnerDraftErrors({ ...draft, values: { name: "Owner business", description: "A real owner supplied description.", timezone: "America/Chicago" } }), {});
  assert.equal(firstOwnerErrorStep(firstOwnerDraftErrors({ ...draft, values: { name: "Owner business", description: "A real owner supplied description.", timezone: "Invented/Place" } })), 2);
});

test("a new draft suggests the device timezone and ignores malformed values", () => {
  const scope = "00000000-0000-4000-8000-000000000001", key = "00000000-0000-4000-8000-000000000002";
  assert.equal(newFirstOwnerDraft(scope, key, Date.now(), "America/Chicago").values.timezone, "America/Chicago");
  assert.equal(newFirstOwnerDraft(scope, key, Date.now(), "America/Argentina/Buenos_Aires").values.timezone, "America/Argentina/Buenos_Aires");
  assert.equal(newFirstOwnerDraft(scope, key, Date.now(), "not a zone").values.timezone, "");
  assert.equal(newFirstOwnerDraft(scope, key).values.timezone, "");
});
