import assert from "node:assert/strict";
import test from "node:test";
import { effectiveAuthoritySnapshot, evaluateAuthority, readEffectiveAuthority, evaluateInternalBookingAuthority, internalCalendarEnabled, contextReviewIsCurrent, type AuthorityConnection } from "../lib/agents/authority.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
const settings = { status: "active", authority_revision: 4, channel_authority: { instagram: "require_approval" as const, email: "require_approval" as const }, conversations_enabled: true, sales_enabled: true, scheduling_enabled: true };
const activation = { status: "active", instagram: true, email: true };
const instagram: AuthorityConnection = { id: "ig", status: "connected", runtime_mode: "live", provider_key: "instagram_messaging", config: {} };
test("no activation or explicit owner choice silently activates a channel", () => {
  assert.equal(effectiveAuthoritySnapshot({ status: "active", conversations_enabled: true }, null, [instagram]).channels.instagram, "off");
});
test("stop prevents new drafts and approved unsent execution", () => {
  const authority = effectiveAuthoritySnapshot({ ...settings, channel_authority: { instagram: "off" } }, activation, [instagram]);
  for (const phase of ["draft", "execute"] as const)
    assert.equal(evaluateAuthority({ authority, channel: "instagram", phase, approved: true, connection: instagram }).allowed, false);
});
test("a paused team permits observation but prevents drafts and external work", () => {
  const authority = effectiveAuthoritySnapshot({ ...settings, status: "paused" }, activation, [instagram]);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "observe" }).allowed, true);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "draft" }).allowed, false);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: true, connection: instagram }).allowed, false);
});
test("changing policy revision invalidates an earlier approved action", () => {
  const authority = effectiveAuthoritySnapshot(settings, activation, [instagram]);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: true, connection: instagram, expectedRevision: 3 }).allowed, false);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: true, connection: instagram, expectedRevision: 4 }).allowed, true);
});
test("observation, drafting and external approval remain separate permissions", () => {
  for (const mode of ["observe", "draft", "require_approval"] as const) {
    const authority = effectiveAuthoritySnapshot({ ...settings, channel_authority: { instagram: mode } }, activation, [instagram]);
    assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "draft" }).allowed, mode !== "observe");
    assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: true, connection: instagram }).allowed, mode === "require_approval");
    assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: false, connection: instagram }).allowed, false);
  }
});
test("manager authority cannot escalate a read-only provider account", () => {
  const readonly: AuthorityConnection = { id: "mail", status: "connected", runtime_mode: "live", provider_key: "google_workspace", config: { workspace_view_only: true } };
  const authority = effectiveAuthoritySnapshot(settings, activation, [readonly]);
  assert.equal(authority.channels.email, "observe");
  assert.equal(evaluateAuthority({ authority, channel: "email", phase: "execute", approved: true, connection: readonly }).allowed, false);
});
test("an exact read-only account remains blocked even if another account is writable", () => {
  const readonly: AuthorityConnection = { id: "mail", status: "connected", runtime_mode: "live", provider_key: "google_workspace", config: { workspace_view_only: true } };
  const writable = { ...readonly, id: "other", config: {} };
  const authority = effectiveAuthoritySnapshot(settings, activation, [readonly, writable]);
  assert.equal(authority.channels.email, "require_approval");
  assert.equal(evaluateAuthority({ authority, channel: "email", phase: "execute", approved: true, connection: readonly }).allowed, false);
  assert.equal(evaluateAuthority({ authority, channel: "email", phase: "draft", connection: readonly }).allowed, false);
});
test("the production loader scopes every privileged query and never falls back from a pinned account", async () => {
  const seen: { table: string; filters: Record<string, unknown> }[] = [];
  const admin = { from(table: string) {
    const filters: Record<string, unknown> = {};
    seen.push({ table, filters });
    const result = () => ({ error: null, data: table === "agent_team_settings" ? settings
      : table === "business_agent_activation" ? activation
      : table === "business_workspace_profiles" ? { updated_at: "profile-v1", profile: { description: "Services" } }
      : table === "business_context_reviews" ? { profile_revision: "profile-v1" }
      : table === "client_knowledge_profiles" ? { business_description: "Services" }
      : [{ ...instagram, provider: { provider_key: instagram.provider_key } }] });
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters[key] = value; return query; },
      maybeSingle() { return Promise.resolve(result()); },
      then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return query;
  } } as unknown as SupabaseClient;
  const result = await readEffectiveAuthority(admin, { partnerId: "authorized-partner", clientId: "authorized-client" }, "instagram", { phase: "execute", approved: true, connectionId: "another-business-account" });
  assert.equal(result.allowed, false);
  assert.equal(seen.length, 6);
  for (const query of seen) assert.deepEqual(query.filters, { partner_id: "authorized-partner", client_id: "authorized-client" });
});
test("missing or stale context reviews and conflicting supplied knowledge cap authority to observation", () => {
  const profile = { description: "Services", services: "Appointments", hours: "9 to 5", policies: "Cancel a day ahead" };
  const knowledge = { business_description: " Services ", services_offered: "Appointments", business_hours: "9 to 5", booking_rules: "Cancel a day ahead" };
  assert.equal(contextReviewIsCurrent("v1", "v1", profile, knowledge), true);
  assert.equal(contextReviewIsCurrent("v2", "v1", profile, knowledge), false);
  assert.equal(contextReviewIsCurrent("v1", null, profile, knowledge), false);
  assert.equal(contextReviewIsCurrent("v1", "v1", profile, { ...knowledge, booking_rules: "No cancellations" }), false);
  const authority = effectiveAuthoritySnapshot({ ...settings, context_reviewed: false }, activation, [instagram]);
  assert.equal(authority.channels.instagram, "observe");
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "draft" }).allowed, false);
  assert.equal(evaluateAuthority({ authority, channel: "instagram", phase: "execute", approved: true, connection: instagram }).allowed, false);
});
test("internal calendar uses the actual business capability and selected approved booking authority", () => {
  const client = { status: "active", crm_operating_mode: "primary_crm", default_runtime_mode: "live" };
  const input = { settings, activation: { ...activation, bookings: true }, client, approved: true, expectedRevision: 4 };
  assert.equal(internalCalendarEnabled(client), true);
  assert.equal(evaluateInternalBookingAuthority(input).allowed, true);
  assert.equal(effectiveAuthoritySnapshot(settings, input.activation, [], { internalCalendarEnabled: true }).channels.calendar, "require_approval");
  for (const change of [
    { approved: false },
    { expectedRevision: 3 },
    { activation: { ...input.activation, bookings: false } },
    { settings: { ...settings, status: "paused" } },
    { settings: { ...settings, channel_authority: { calendar: "draft" as const } } },
    { settings: { ...settings, channel_authority: { calendar: "off" as const } } },
    { client: { ...client, default_runtime_mode: "dry_run" } },
    { client: { ...client, status: "inactive" } },
    { client: { ...client, crm_operating_mode: "external_only" } },
  ]) assert.equal(evaluateInternalBookingAuthority({ ...input, ...change }).allowed, false);
});
