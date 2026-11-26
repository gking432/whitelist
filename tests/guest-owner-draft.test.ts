import assert from "node:assert/strict";
import test from "node:test";
import { GUEST_OWNER_DRAFT_KEY, GUEST_OWNER_DRAFT_TTL_MS, clearGuestOwnerDraft, guestGoogleAuthorizationUrl, guestOwnerDraftErrors, newGuestOwnerDraft, parseGuestOwnerDraft, readGuestOwnerDraft, startGuestGoogleAuthorization, writeGuestOwnerDraft } from "../components/onboarding/guest-owner-draft.ts";

const draftId = "10000000-0000-4000-8000-000000000001", requestKey = "20000000-0000-4000-8000-000000000001", otherId = "30000000-0000-4000-8000-000000000001", now = 1_800_000_000_000;
const supabaseUrl = "https://synthetic.supabase.co", authorize = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fsynthetic.invalid%2Fauth%2Fgoogle%2Fcallback`;
function memory() {
  const items = new Map<string, string>(), touched: string[] = [];
  return { items, touched, getItem(key: string) { touched.push(key); return items.get(key) ?? null; }, setItem(key: string, value: string) { touched.push(key); items.set(key, value); }, removeItem(key: string) { touched.push(key); items.delete(key); } };
}
test("guest drafts start empty, retain local request identity through Back/refresh and never inspect actor storage", () => {
  const store = memory(), draft = newGuestOwnerDraft(draftId, requestKey, now);
  store.items.set(`workstation:first-owner:v1:${otherId}`, "private actor draft");
  assert.deepEqual(draft.values, { name: "", description: "", timezone: "" });
  assert.equal(writeGuestOwnerDraft(store, { ...draft, step: 1, values: { ...draft.values, name: "Owner supplied name" } }, now), true);
  const restored = readGuestOwnerDraft(store, now + 10)!;
  assert.equal(restored.step, 1); assert.equal(restored.draftId, draftId); assert.equal(restored.requestKey, requestKey); assert.equal(restored.values.name, "Owner supplied name");
  assert.equal(writeGuestOwnerDraft(store, { ...restored, step: 0 }, now + 20), true);
  assert.equal(readGuestOwnerDraft(store, now + 30)?.values.name, "Owner supplied name");
  assert.ok(store.touched.every(key => key === GUEST_OWNER_DRAFT_KEY));
});
test("strict guest parsing rejects identity/provider/URL payloads, malformed/expired drafts and unsafe or oversized fields", () => {
  const draft = newGuestOwnerDraft(draftId, requestKey, now);
  for (const value of [
    { ...draft, version: 2 }, { ...draft, actorId: otherId }, { ...draft, clientId: otherId }, { ...draft, email: "private@synthetic.invalid" }, { ...draft, tokens: "secret" }, { ...draft, providerStatus: "connected" }, { ...draft, url: authorize },
    { ...draft, step: 4 }, { ...draft, step: -1 }, { ...draft, draftId: "unknown" }, { ...draft, requestKey: "unknown" }, { ...draft, expiresAt: now }, { ...draft, expiresAt: now + GUEST_OWNER_DRAFT_TTL_MS + 1 },
    { ...draft, values: { ...draft.values, actorId: otherId } }, { ...draft, values: { ...draft.values, name: "n".repeat(101) } }, { ...draft, values: { ...draft.values, description: "d".repeat(2001) } }, { ...draft, values: { ...draft.values, timezone: "UTC\u0000" } },
  ]) assert.equal(parseGuestOwnerDraft(JSON.stringify(value), now), null);
  assert.equal(parseGuestOwnerDraft("{broken", now), null); assert.equal(parseGuestOwnerDraft(" ".repeat(16385), now), null);
  const store = memory(); writeGuestOwnerDraft(store, draft, now); assert.equal(readGuestOwnerDraft(store, now + GUEST_OWNER_DRAFT_TTL_MS), null); assert.equal(store.items.size, 0);
  assert.throws(() => newGuestOwnerDraft("not-an-actor", requestKey, now));
});
test("guest handoff cleanup pins both local identifiers and storage failure does not become a saved claim", () => {
  const store = memory(), draft = newGuestOwnerDraft(draftId, requestKey, now); writeGuestOwnerDraft(store, draft, now);
  assert.equal(clearGuestOwnerDraft(store, { draftId: otherId, requestKey }, now), false); assert.notEqual(readGuestOwnerDraft(store, now), null);
  assert.equal(clearGuestOwnerDraft(store, { draftId, requestKey: otherId }, now), false);
  assert.equal(clearGuestOwnerDraft(store, { draftId, requestKey }, now), true); assert.equal(store.items.size, 0);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(writeGuestOwnerDraft(blocked, draft, now), false); assert.equal(readGuestOwnerDraft(blocked, now), null); assert.equal(clearGuestOwnerDraft(blocked), false);
});
test("guest answers use the real first-owner validation and never infer a timezone", () => {
  const draft = newGuestOwnerDraft(draftId, requestKey, now);
  assert.deepEqual(Object.keys(guestOwnerDraftErrors(draft)), ["name", "description", "timezone"]);
  const complete = { ...draft, values: { name: "Owner business", description: "Owner supplied business description.", timezone: "America/Chicago" } };
  assert.deepEqual(guestOwnerDraftErrors(complete), {}); assert.ok(guestOwnerDraftErrors({ ...complete, values: { ...complete.values, timezone: "Invented/Place" } }).timezone);
});
test("Google navigation accepts only this configured Supabase authorize endpoint and one exact Google provider", () => {
  assert.equal(guestGoogleAuthorizationUrl(authorize, supabaseUrl), authorize);
  assert.equal(guestGoogleAuthorizationUrl("http://127.0.0.1:54321/auth/v1/authorize?provider=google", "http://127.0.0.1:54321"), "http://127.0.0.1:54321/auth/v1/authorize?provider=google");
  for (const value of ["/auth/v1/authorize?provider=google", "https://foreign.invalid/auth/v1/authorize?provider=google", `${supabaseUrl}/other?provider=google`, `${authorize}#carrier`, `${authorize}&provider=google`, `${supabaseUrl}/auth/v1/authorize?provider=github`, "https://person:secret@synthetic.supabase.co/auth/v1/authorize?provider=google", "javascript:alert(1)"]) assert.throws(() => guestGoogleAuthorizationUrl(value, supabaseUrl));
  assert.throws(() => guestGoogleAuthorizationUrl(authorize, undefined)); assert.throws(() => guestGoogleAuthorizationUrl("http://synthetic.invalid/auth/v1/authorize?provider=google", "http://synthetic.invalid"));
});
test("one explicit Google start sends only local IDs and validates bounded success without automatic retry or private request", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const request = (async (url: string | URL | Request, options: RequestInit) => { calls.push({ url: String(url), options }); return Response.json({ url: authorize }); }) as typeof fetch;
  assert.equal(await startGuestGoogleAuthorization({ draftId, requestKey }, supabaseUrl, undefined, request), authorize);
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "/auth/google/start"); assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body as string), { draftId, requestKey }); assert.equal(calls[0].options.credentials, "same-origin"); assert.equal(calls[0].options.redirect, "error");
  assert.equal((calls[0].options.headers as Record<string, string>).Authorization, undefined);
  for (const response of [Response.json({ url: authorize }, { status: 503 }), Response.json({ url: authorize, connected: true }), Response.json({ url: `${supabaseUrl}/auth/v1/authorize?provider=github` }), new Response("x".repeat(16385)), new Response('{"url":"private-token",broken')]) {
    let attempts = 0; await assert.rejects(startGuestGoogleAuthorization({ draftId, requestKey }, supabaseUrl, undefined, (async () => { attempts++; return response; }) as typeof fetch), error => error instanceof Error && !error.message.includes("private-token")); assert.equal(attempts, 1);
  }
  let touched = false; await assert.rejects(startGuestGoogleAuthorization({ draftId, requestKey, actorId: otherId } as unknown as { draftId: string; requestKey: string }, supabaseUrl, undefined, (async () => { touched = true; }) as unknown as typeof fetch)); assert.equal(touched, false);
});
