// Source/runtime contract checks only. Actual SQL/catalog/locking proof is CI.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ONBOARDING_STEPS, OnboardingRequestSchema } from "../lib/business/onboarding-contract.ts";
import { buildKnowledgeBlock, getKnowledgeProfile } from "../lib/knowledge/profile.ts";

const migration = await readFile(new URL("../supabase/migrations/20261121212831_owner_onboarding_progress.sql", import.meta.url), "utf8");
const asset = await readFile(new URL("../scripts/sql/owner-onboarding-acceptance.sql", import.meta.url), "utf8");
const snapshot = migration.split("create function owner_onboarding.onboarding_snapshot")[1].split("end $$;")[0];
const revisionSource = migration.split("create function public.get_business_profile_snapshot")[1].split("end $$;")[0];
const save = migration.split("create function owner_onboarding.save_onboarding")[1].split("end $$;")[0];

test("onboarding keeps direct progress private behind four owner functions, two service-only settings functions and one private lock primitive", () => {
  assert.equal((migration.match(/create function /g) ?? []).length, 7);
  assert.equal((migration.match(/security definer set search_path=''/g) ?? []).length, 3);
  assert.equal((migration.match(/security invoker set search_path=''/g) ?? []).length, 4);
  assert.match(migration, /alter table public\.owner_onboarding_progress enable row level security/);
  assert.match(migration, /revoke all on public\.owner_onboarding_progress from public,anon,authenticated/);
  assert.match(migration, /primary key\(user_id,client_id\)/);
  assert.match(migration, /foreign key\(partner_id,client_id\)/);
  assert.doesNotMatch(migration, /create policy|grant .*owner_onboarding_progress to authenticated/i);
  assert.doesNotMatch(save, /p_actor|p_partner/);
  assert.match(migration, /revoke all on function public\.save_business_profile\(uuid,uuid,uuid,uuid,text,jsonb\) from public,anon,authenticated/);
  assert.match(migration, /public\.save_owner_onboarding\(p_client uuid,p_key uuid,p_revision bigint,p_command jsonb\)/);
  assert.match(migration, /revoke all on function owner_onboarding\.lock_profile_actor\(uuid\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function owner_onboarding\.lock_profile_actor\(uuid\) to service_role/);
});
test("owner/session checks and no-key actor locking preserve revocation and receipt-FK lock compatibility", () => {
  assert.match(save, /actor uuid:=owner_onboarding\.workspace_actor\(p_client\)/);
  assert.equal((save.match(/m\.role='client_owner'/g) ?? []).length, 3);
  const actorLock = save.indexOf("from auth.users u where u.id=actor for no key update");
  const sessionLock = save.indexOf("from auth.sessions s");
  const businessLock = save.indexOf("from public.client_businesses c where c.id=p_client for update");
  const profileLock = save.indexOf("from public.business_workspace_profiles p where p.partner_id=partner and p.client_id=p_client for update");
  const knowledgeLock = save.indexOf("from public.client_knowledge_profiles k where k.partner_id=partner and k.client_id=p_client for update");
  assert.ok(actorLock > 0 && actorLock < sessionLock && sessionLock < businessLock && businessLock < profileLock && profileLock < knowledgeLock);
  assert.ok(save.indexOf("perform owner_onboarding.workspace_actor(p_client)", sessionLock) < businessLock);
  assert.ok(save.indexOf("perform owner_onboarding.workspace_actor(p_client)", businessLock) < profileLock);
});
test("the opaque source revision covers raw profile plus knowledge content and timezone-stable clocks", () => {
  assert.match(snapshot, /public\.get_business_profile_snapshot\(partner,p_client\)/);
  assert.match(revisionSource, /md5\(jsonb_build_array\(/);
  assert.match(revisionSource, /extract\(epoch from profile_row\.updated_at\),profile_row\.profile/);
  assert.match(revisionSource, /extract\(epoch from knowledge_row\.updated_at\),to_jsonb\(knowledge_row\)-array/);
  assert.match(revisionSource, /profile_absent/); assert.match(revisionSource, /knowledge_absent/);
  assert.doesNotMatch(save, /expected_profile|expectedProfileRevision.*::timestamptz/);
  const knowledgeLock = save.indexOf("from public.client_knowledge_profiles k where k.partner_id=partner and k.client_id=p_client for update");
  const cas = save.indexOf("profile_revision is distinct from p_command->'expectedProfileRevision'");
  const write = save.indexOf("insert into public.client_knowledge_profiles");
  assert.ok(knowledgeLock < cas && cas < write);
});
test("one raw key and only its agent description copy change while old unknowns and knowledge survive", () => {
  assert.match(save, /p_command->>'field' is distinct from 'description'/);
  assert.match(save, /old_raw-'description' else jsonb_set\(old_raw,array\['description'\],p_command->'value',true\)/);
  assert.match(save, /new_raw is distinct from old_raw or knowledge_row\.business_description is distinct from description_value/);
  assert.match(save, /insert into public\.client_knowledge_profiles\(partner_id,client_id,business_description\)/);
  assert.match(save, /update public\.client_knowledge_profiles k set business_description=description_value\s+where/);
  assert.doesNotMatch(save, /set (services_offered|business_hours|booking_rules|profile=command\.profile)|EMPTY_PROFILE|PROFILE_SCHEMA/);
  assert.match(save, /greatest\(clock_timestamp\(\),p\.updated_at\+interval '1 microsecond'\)/);
  assert.match(save, /cancelled:=public\.cancel_business_unsent\(partner,p_client,null\)/);
});
test("historical exact replay precedes revision checks and returns original applied result with a current snapshot", () => {
  const receipt = save.indexOf("if found then");
  const cas = save.indexOf("coalesce(progress_row.revision,0)<>p_revision");
  const firstWrite = save.indexOf("insert into public.client_knowledge_profiles");
  assert.ok(receipt > 0 && receipt < cas && cas < firstWrite);
  assert.match(save, /receipt\.actor_id is distinct from actor or receipt\.command is distinct from envelope/);
  assert.match(save, /jsonb_build_object\('action','owner_onboarding','revision',p_revision,'command',p_command\)/);
  assert.match(save, /'snapshot',owner_onboarding\.onboarding_snapshot\(p_client\),'result',receipt\.result\|\|jsonb_build_object\('replayed',true\)/);
  assert.doesNotMatch(save, /40001|40P01|serialization_failure|deadlock_detected|when others/);
});
test("fixed progress and description validation agree with the shared short-journey protocol", () => {
  for (const step of ONBOARDING_STEPS) assert.ok(migration.includes(`'${step}'`));
  assert.match(migration, /check\(finished=\(step='done'\) and finished=\(finished_at is not null\)\)/);
  assert.match(save, /when 'assistant' then 'review' when 'assistant_choice' then 'review'/);
  assert.match(save, /action_value='skip' and p_command->>'step'='done'/);
  assert.ok(save.includes(String.raw`U&'[\0001-\0008\000B\000C\000E-\001F\007F]'`));
  const command = { action: "answer", field: "description", value: "A business\nwith ordinary\ttabs", expectedProfileRevision: "a".repeat(32), key: "11111111-1111-4111-8111-111111111111", revision: 0 };
  assert.equal(OnboardingRequestSchema.safeParse(command).success, true);
  for (const value of ["", "   ", "forbidden\u0001control", "a".repeat(3001)]) assert.equal(OnboardingRequestSchema.safeParse({ ...command, value }).success, false);
  assert.equal(OnboardingRequestSchema.safeParse({ ...command, field: "services" }).success, false);
});
test("the actual SQL asset retains catalog, combined-CAS, cancellation, owner isolation and no-effect checks", () => {
  assert.equal((asset.match(/-- Group(?:[1-9]|10|11):/g) ?? []).length, 11);
  for (const token of ["same-transaction changes", "Combined token missed a same-clock knowledge-only edit", "Cross-owner stale shared token", "Historical retry", "work-protected", "failed-external", "Revoked owner", "Ended session", "owner_onboarding_acceptance"]) assert.ok(asset.includes(token));
  for (const key of ["owner", "securityDefiner", "configuration", "publicExecute", "anonExecute", "authenticatedExecute", "serviceExecute"]) assert.ok(asset.includes(`'${key}'`));
  assert.match(asset, /rollback;\nselect '__CUSTOMER_JOURNEY_REPORT__'::text/);
  assert.doesNotMatch(asset, /disable trigger|disable row level security|session_replication_role|insert into public\.business_agent_activation/i);
});
test("the existing agent knowledge loader and prompt block consume the synchronized description column", async () => {
  const calls: unknown[] = [];
  const committed = { id: "knowledge", partner_id: "partner", client_id: "client", business_description: "New explicit owner fact", services_offered: "Existing service", business_hours: "Existing hours", faq: [], emergency_rules: null, service_areas: null, pricing_disclaimer: null, booking_rules: null, escalation_rules: null };
  const client = { from(table: string) { calls.push(table); return { select(columns: string) { calls.push(columns); return { eq(column: string, value: string) { calls.push([column, value]); return { maybeSingle: async () => ({ data: { ...committed } }) }; } }; } }; } } as unknown as Parameters<typeof getKnowledgeProfile>[0];
  const result = await getKnowledgeProfile(client, "client");
  assert.deepEqual(calls, ["client_knowledge_profiles", "*", ["client_id", "client"]]);
  assert.equal(result?.business_description, committed.business_description);
  assert.equal(result?.services_offered, committed.services_offered);
  assert.match(buildKnowledgeBlock("Business", result), /About the business: New explicit owner fact/);
  assert.match(buildKnowledgeBlock("Business", result), /Business hours: Existing hours/);
});

test("legacy full settings use the same combined CAS and durable receipt while preserving unknown raw keys and unrelated knowledge", () => {
  const full = migration.split("create function public.save_business_profile")[1].split("end $$;")[0];
  assert.doesNotMatch(full, /workspace_actor|client_owner|auth\.uid|when others|40001|40P01/);
  assert.match(full, /not exists\(select 1 from public\.profiles p where p\.id=p_actor\)/);
  assert.doesNotMatch(full, /from auth\.(users|sessions)/);
  assert.match(asset, /has_table_privilege\('service_role','auth\.users','SELECT'\)/);
  assert.match(asset, /has_table_privilege\('service_role','auth\.sessions','SELECT'\)/);
  assert.match(full, /new_raw:=old_raw\|\|p_profile/);
  assert.match(full, /receipt\.actor_id is distinct from p_actor or receipt\.command is distinct from envelope/);
  const business = full.indexOf("from public.client_businesses c");
  const actor = full.indexOf("perform owner_onboarding.lock_profile_actor(p_actor)");
  const profile = full.indexOf("from public.business_workspace_profiles p");
  const knowledge = full.indexOf("from public.client_knowledge_profiles k");
  const cas = full.indexOf("current_revision is distinct from p_revision");
  const copy = full.indexOf("insert into public.client_knowledge_profiles");
  const settings = full.indexOf("insert into public.agent_team_settings");
  assert.ok(actor > 0 && actor < business && business < profile && profile < knowledge && knowledge < cas && cas < copy && copy < settings);
  assert.match(full, /set business_description=p_profile->>'description',services_offered=p_profile->>'services',business_hours=p_profile->>'hours',booking_rules=p_profile->>'policies'/);
  assert.doesNotMatch(full, /set (service_areas|emergency_rules|pricing_disclaimer|faq|escalation_rules|ai_disclosure|updated_by)/);
  assert.match(asset, /Full profile stale source overwrote facts/);
  assert.match(asset, /Stale full save overwrote the wizard or its agent description/);
});
test("the service-only private lock helper has only the exact actor row lock and returns no Auth data", () => {
  const helper = migration.split("create function owner_onboarding.lock_profile_actor")[1].split("end $$;")[0];
  assert.match(helper, /\(p_actor uuid\) returns void/);
  assert.match(helper, /security definer set search_path=''/);
  assert.match(helper, /perform 1 from auth\.users u where u\.id=p_actor for no key update/);
  assert.match(helper, /if not found then raise exception 'Business actor unavailable' using errcode='42501'/);
  assert.doesNotMatch(helper, /select \*|return query|return json|auth\.sessions|insert into|update public|delete from|grant|when others/i);
  assert.match(asset, /Browser invoked privileged actor lock/); assert.match(asset, /Service actor lock accepted an unknown identity/);
});
