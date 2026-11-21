// Real disposable PostgreSQL cases only when called by the validated verifier.
// Synthetic Auth sessions are not browser sign-in or provider/model evidence.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const OWNER_ONBOARDING_CONCURRENCY_CASES = 4;
export async function runOwnerOnboardingConcurrency(target, deps) {
  assert.ok(target && /^[a-z0-9_]+_(test|acceptance)$/.test(target.database), "Onboarding races require the existing named disposable target.");
  for (const key of ["query", "readReport", "heldTransaction", "isolationAssertion", "literal"]) assert.equal(typeof deps?.[key], "function", "Onboarding races require the validated verifier dependencies.");
  assert.equal(typeof deps.reportPrefix, "string");
  const { query, readReport, heldTransaction, isolationAssertion, literal: q, reportPrefix } = deps;
  const ids = Object.fromEntries(["run", "partner", "lockClient", "legacyClient", "raceClient", "preferenceClient", "preferenceKey", "preferenceFullKey", "ownerA", "ownerB", "sessionA", "sessionB"].map(key => [key, randomUUID()]));
  const prefix = `cj-acceptance-${ids.run}-onboarding-races`, active = new Set();
  const emit = (kind, values) => `select ${q(reportPrefix)}::text || jsonb_build_object('kind',${q(kind)},${values}) as cj_report;`;
  const claims = (who) => `set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub',${q(ids[`owner${who}`])},true); select set_config('request.jwt.claims',${q(JSON.stringify({ role: "authenticated", sub: ids[`owner${who}`], session_id: ids[`session${who}`] }))},true);`;
  const launch = (sql) => { const pending = query(target, sql); active.add(pending); pending.finally(() => active.delete(pending)).catch(() => {}); pending.catch(() => {}); return pending; };
  async function observeBlocked(application, holder, actorBeforeBusiness = false) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const state = readReport(await query(target, `begin read only; set local statement_timeout='3s'; ${emit("onboarding_observed_wait", `'blocked',(select count(*) from pg_catalog.pg_stat_activity waiter where waiter.datname=current_database() and waiter.application_name=${q(application)} and waiter.wait_event_type='Lock' and exists(select 1 from pg_catalog.pg_stat_activity holder where holder.datname=current_database() and holder.application_name=${q(holder)} and holder.pid=any(pg_catalog.pg_blocking_pids(waiter.pid)))),
 'businessRowLocks',(select count(*) from pg_catalog.pg_locks l join pg_catalog.pg_stat_activity waiter on waiter.pid=l.pid where waiter.datname=current_database() and waiter.application_name=${q(application)} and l.relation='public.client_businesses'::regclass and l.mode='RowShareLock' and l.granted)`)} rollback;`), "onboarding_observed_wait");
      if (state.blocked === 1) {
        if (actorBeforeBusiness) assert.equal(state.businessRowLocks, 0, "The full-profile waiter must block on its exact actor holder before acquiring any business row-lock relation.");
        return;
      }
      // Scheduling backoff is not acceptance. Only the observed blocker above
      // permits release of the held transaction and a successful case.
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The original onboarding transaction was not observed waiting on its exact live holder.");
  }
  const initialProfile = { description: "Initial shared business fact", future_fact: { retain: "unknown raw content" } };
  const fullProfile = { description: "Atomic legacy full settings winner", industry: "services", goals: [], services: "Legacy explicit service", audience: "Local customers", tone: "Calm", hours: "Legacy explicit hours", policies: "Legacy explicit policy", currency: "CAD", website: "https://synthetic.invalid" };
  const preferenceProfile = { ...fullProfile, description: "Full settings after the actual preference transaction" };
  const preferenceSettings = { displayName: "Synthetic owner", order: ["appointments", "messages", "todo", "money"], pinned: ["appointments"] };
  const answer = (client, revision, value) => `public.save_owner_onboarding(${q(client)},extensions.gen_random_uuid(),0,jsonb_build_object('action','answer','field','description','value',${q(value)},'expectedProfileRevision',${q(revision)}))`;
  let failure;
  try {
    const fixture = readReport(await query(target, `begin; set local statement_timeout='10s'; ${isolationAssertion(target.database)}
 insert into auth.users(id,email,email_confirmed_at) values(${q(ids.ownerA)},${q(`${prefix}-a@synthetic.invalid`)},now()),(${q(ids.ownerB)},${q(`${prefix}-b@synthetic.invalid`)},now());
 insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(${q(ids.sessionA)},${q(ids.ownerA)},now(),now(),now()+interval '1 hour'),(${q(ids.sessionB)},${q(ids.ownerB)},now(),now(),now()+interval '1 hour');
 insert into public.partners(id,name,slug,status) values(${q(ids.partner)},'Synthetic customer journey acceptance onboarding races',${q(prefix)},'active');
 insert into public.client_businesses(id,partner_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 values ${["lockClient", "legacyClient", "raceClient", "preferenceClient"].map(key => `(${q(ids[key])},${q(ids.partner)},'Synthetic customer journey acceptance onboarding race',${q(`${prefix}-${key}`)},'active',true,'sandbox')`).join(",")};
 insert into public.memberships(user_id,partner_id,client_id,role,status) values ${["lockClient", "legacyClient", "raceClient", "preferenceClient"].map(key => `(${q(ids.ownerA)},${q(ids.partner)},${q(ids[key])},'client_owner','active')`).join(",")},(${q(ids.ownerB)},${q(ids.partner)},${q(ids.raceClient)},'client_owner','active');
 insert into public.agent_team_settings(partner_id,client_id,status,channel_authority)
 select ${q(ids.partner)},c.id,case when c.id=${q(ids.lockClient)}::uuid then 'active' else 'paused' end,'{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}'::jsonb from public.client_businesses c where c.partner_id=${q(ids.partner)};
 insert into public.business_workspace_profiles(partner_id,client_id,profile) select ${q(ids.partner)},c.id,${q(JSON.stringify(initialProfile))}::jsonb from public.client_businesses c where c.partner_id=${q(ids.partner)};
 insert into public.client_knowledge_profiles(partner_id,client_id,business_description,services_offered,business_hours,booking_rules,emergency_rules)
 select ${q(ids.partner)},c.id,'Initial shared business fact','Existing service','Existing hours','Existing policy','Unrelated retained safety fact' from public.client_businesses c where c.partner_id=${q(ids.partner)};
 commit; ${emit("onboarding_race_fixture", `'clients',(select count(*) from public.client_businesses where partner_id=${q(ids.partner)}),'sessions',(select count(*) from auth.sessions where id in(${q(ids.sessionA)},${q(ids.sessionB)})),'legacyRevision',public.get_business_profile_snapshot(${q(ids.partner)},${q(ids.legacyClient)})->>'revision','raceRevision',public.get_business_profile_snapshot(${q(ids.partner)},${q(ids.raceClient)})->>'revision','preferenceRevision',public.get_business_profile_snapshot(${q(ids.partner)},${q(ids.preferenceClient)})->>'revision'`)} `), "onboarding_race_fixture");
    assert.ok(fixture.clients === 4 && fixture.sessions === 2 && [fixture.legacyRevision, fixture.raceRevision, fixture.preferenceRevision].every(value => /^[a-f0-9]{32}$/.test(value)), "The actual scoped onboarding race fixture was not established.");

    // Case1: Pause owns business first. The waiter has already acquired its
    // actor/session locks when it blocks. Pause's real receipt actor FK must
    // still acquire KEY SHARE; FOR UPDATE on the actor would deadlock here.
    let waiter;
    const controlHolder = `onboarding-control-${ids.run}`, controlWaiter = `onboarding-context-wait-${ids.run}`;
    await heldTransaction(target, `set local application_name=${q(controlHolder)}; set local role service_role; select id from public.client_businesses where id=${q(ids.lockClient)} and partner_id=${q(ids.partner)} for update;`, async () => {
      waiter = launch(`begin; set local statement_timeout='10s'; set local lock_timeout='8s'; set local application_name=${q(controlWaiter)}; create temp table onboarding_lock_result(value jsonb); grant insert,select on onboarding_lock_result to authenticated; ${claims("A")}
 insert into onboarding_lock_result select public.save_owner_onboarding(${q(ids.lockClient)},extensions.gen_random_uuid(),0,'{"action":"navigate","step":"connections"}'); commit;
 ${emit("onboarding_context_waiter", `'revision',(select value->'result'->>'revision' from onboarding_lock_result),'step',(select value->'snapshot'->'progress'->>'step' from onboarding_lock_result)`)} `);
      await observeBlocked(controlWaiter, controlHolder);
    }, `select public.apply_business_context_command(${q(ids.partner)},${q(ids.lockClient)},${q(ids.ownerA)},jsonb_build_object('action','manager_control','key',extensions.gen_random_uuid(),'expectedRevision',(select authority_revision from public.agent_team_settings where client_id=${q(ids.lockClient)} and partner_id=${q(ids.partner)}),'operation','pause'));`);
    const contextResult = readReport(await waiter, "onboarding_context_waiter");
    assert.ok(contextResult.revision === "1" && contextResult.step === "connections", "The onboarding waiter did not complete after the real control receipt committed.");

    // Case2: one atomic full-settings writer commits both copies. The waiter
    // retains its pre-holder combined token and may catch ONLY semantic PT409.
    const legacyHolder = `onboarding-legacy-${ids.run}`, legacyWaiter = `onboarding-legacy-wait-${ids.run}`;
    await heldTransaction(target, `set local application_name=${q(legacyHolder)}; set local role service_role; select public.save_business_profile(${q(ids.partner)},${q(ids.legacyClient)},${q(ids.ownerA)},extensions.gen_random_uuid(),${q(fixture.legacyRevision)},${q(JSON.stringify(fullProfile))}::jsonb);`, async () => {
      waiter = launch(`begin; set local statement_timeout='10s'; set local lock_timeout='8s'; set local application_name=${q(legacyWaiter)}; create temp table onboarding_stale_result(code text); grant insert,select on onboarding_stale_result to authenticated; ${claims("A")}
 do $stale$ begin begin perform ${answer(ids.legacyClient, fixture.legacyRevision, "Stale partial overwrite must not save")}; insert into onboarding_stale_result values('unexpected_success'); exception when sqlstate 'PT409' then insert into onboarding_stale_result values(sqlstate); end; end $stale$;
 commit; ${emit("onboarding_legacy_waiter", `'code',(select code from onboarding_stale_result)`)} `);
      await observeBlocked(legacyWaiter, legacyHolder);
    });
    const stale = readReport(await waiter, "onboarding_legacy_waiter");
    assert.equal(stale.code, "PT409", "A stale partial answer overwrote the committed atomic full settings.");

    // Case3: distinct genuine synthetic actors share one profile token but
    // independent progress0. A real holder/waiter guarantees overlapping intent.
    const ownerHolder = `onboarding-owner-${ids.run}`, ownerWaiter = `onboarding-owner-wait-${ids.run}`;
    await heldTransaction(target, `set local application_name=${q(ownerHolder)}; ${claims("A")} select ${answer(ids.raceClient, fixture.raceRevision, "First owner shared fact winner")};`, async () => {
      waiter = launch(`begin; set local statement_timeout='10s'; set local lock_timeout='8s'; set local application_name=${q(ownerWaiter)}; create temp table onboarding_owner_result(code text); grant insert,select on onboarding_owner_result to authenticated; ${claims("B")}
 do $other_owner$ begin begin perform ${answer(ids.raceClient, fixture.raceRevision, "Second owner stale shared fact")}; insert into onboarding_owner_result values('unexpected_success'); exception when sqlstate 'PT409' then insert into onboarding_owner_result values(sqlstate); end; end $other_owner$;
 commit; ${emit("onboarding_owner_waiter", `'code',(select code from onboarding_owner_result)`)} `);
      await observeBlocked(ownerWaiter, ownerHolder);
    });
    const ownerResult = readReport(await waiter, "onboarding_owner_waiter");
    assert.equal(ownerResult.code, "PT409", "A second owner used private progress0 to overwrite another owner's shared fact.");

    // Case4: the ACTUAL preference RPC owns actor FOR UPDATE and business
    // SHARE until its held transaction commits. The service full-profile
    // writer must wait on that actor before taking business FOR UPDATE; the
    // former reverse order could cycle with preference access/receipt checks.
    const preferenceHolder = `onboarding-preference-${ids.run}`, profileWaiter = `onboarding-profile-wait-${ids.run}`;
    await heldTransaction(target, `set local application_name=${q(preferenceHolder)}; ${claims("A")} select public.save_owner_workspace_preferences(${q(ids.preferenceClient)},${q(ids.preferenceKey)},0,${q(JSON.stringify(preferenceSettings))}::jsonb);`, async () => {
      waiter = launch(`begin; set local statement_timeout='10s'; set local lock_timeout='8s'; set local application_name=${q(profileWaiter)}; create temp table onboarding_preference_result(value jsonb); grant insert,select on onboarding_preference_result to service_role; set local role service_role;
 insert into onboarding_preference_result select public.save_business_profile(${q(ids.partner)},${q(ids.preferenceClient)},${q(ids.ownerA)},${q(ids.preferenceFullKey)},${q(fixture.preferenceRevision)},${q(JSON.stringify(preferenceProfile))}::jsonb);
 commit; ${emit("onboarding_preference_waiter", `'saved',(select value->>'key'=${q(ids.preferenceFullKey)} and value->>'replayed'='false' and value->>'cancelledWork'='0' and value->>'revision' ~ '^[a-f0-9]{32}$' from onboarding_preference_result),
 'receipt',(select count(*)=1 from onboarding_preference_result r join public.business_owner_commands c on c.id=(r.value->>'id')::uuid where c.partner_id=${q(ids.partner)} and c.client_id=${q(ids.preferenceClient)} and c.actor_id=${q(ids.ownerA)} and c.request_key=${q(ids.preferenceFullKey)} and c.command->>'action'='save_business_profile' and c.result=r.value)`)} `);
      await observeBlocked(profileWaiter, preferenceHolder, true);
    });
    const preferenceResult = readReport(await waiter, "onboarding_preference_waiter");
    assert.ok(preferenceResult.saved === true && preferenceResult.receipt === true, "The full-profile save must complete with its exact durable receipt after the real preference transaction commits.");

    const final = readReport(await query(target, `begin read only; set local statement_timeout='5s'; ${emit("onboarding_race_final", `
 'paused',(select status='paused' from public.agent_team_settings where client_id=${q(ids.lockClient)} and partner_id=${q(ids.partner)}),
 'controlFacts',(select profile=${q(JSON.stringify(initialProfile))}::jsonb from public.business_workspace_profiles where client_id=${q(ids.lockClient)}),
 'controlReceipts',(select count(*) from public.business_owner_commands where client_id=${q(ids.lockClient)} and command->>'action'='manager_control'),
 'legacyRaw',(select profile-${q("future_fact")}=${q(JSON.stringify(fullProfile))}::jsonb and profile->'future_fact'=${q(JSON.stringify(initialProfile.future_fact))}::jsonb from public.business_workspace_profiles where client_id=${q(ids.legacyClient)}),
 'legacyKnowledge',(select business_description=${q(fullProfile.description)} and services_offered=${q(fullProfile.services)} and business_hours=${q(fullProfile.hours)} and booking_rules=${q(fullProfile.policies)} and emergency_rules='Unrelated retained safety fact' from public.client_knowledge_profiles where client_id=${q(ids.legacyClient)}),
 'legacyProgress',(select count(*) from public.owner_onboarding_progress where client_id=${q(ids.legacyClient)}),
 'ownerWinner',(select count(*) from public.owner_onboarding_progress where client_id=${q(ids.raceClient)} and user_id=${q(ids.ownerA)} and revision=1 and step='connections'),
 'ownerLoser',(select count(*) from public.owner_onboarding_progress where client_id=${q(ids.raceClient)} and user_id=${q(ids.ownerB)}),
 'ownerRaw',(select profile->>'description'='First owner shared fact winner' and profile->'future_fact'=${q(JSON.stringify(initialProfile.future_fact))}::jsonb from public.business_workspace_profiles where client_id=${q(ids.raceClient)}),
 'ownerKnowledge',(select business_description='First owner shared fact winner' and services_offered='Existing service' and business_hours='Existing hours' and booking_rules='Existing policy' and emergency_rules='Unrelated retained safety fact' from public.client_knowledge_profiles where client_id=${q(ids.raceClient)}),
 'preferenceRaw',(select profile-${q("future_fact")}=${q(JSON.stringify(preferenceProfile))}::jsonb and profile->'future_fact'=${q(JSON.stringify(initialProfile.future_fact))}::jsonb from public.business_workspace_profiles where client_id=${q(ids.preferenceClient)}),
 'preferenceKnowledge',(select business_description=${q(preferenceProfile.description)} and services_offered=${q(preferenceProfile.services)} and business_hours=${q(preferenceProfile.hours)} and booking_rules=${q(preferenceProfile.policies)} and emergency_rules='Unrelated retained safety fact' from public.client_knowledge_profiles where client_id=${q(ids.preferenceClient)}),
 'preferenceSaved',(select count(*)=1 from public.owner_workspace_preferences where user_id=${q(ids.ownerA)} and partner_id=${q(ids.partner)} and client_id=${q(ids.preferenceClient)} and revision=1 and request_key=${q(ids.preferenceKey)} and settings=${q(JSON.stringify(preferenceSettings))}::jsonb),
 'preferenceProgress',(select count(*) from public.owner_onboarding_progress where client_id=${q(ids.preferenceClient)}),
 'jobs',(select count(*) from public.action_jobs where partner_id=${q(ids.partner)})+(select count(*) from public.agent_work_items where partner_id=${q(ids.partner)})+(select count(*) from public.integration_sync_jobs where partner_id=${q(ids.partner)}),
 'approvals',(select count(*) from public.approval_items where partner_id=${q(ids.partner)}),
 'connections',(select count(*) from public.integration_connections where partner_id=${q(ids.partner)}),
 'activation',(select count(*) from public.business_agent_activation where partner_id=${q(ids.partner)}),
 'reviews',(select count(*) from public.business_context_reviews where partner_id=${q(ids.partner)}),
 'unsafeAuthority',(select count(*) from public.agent_team_settings where partner_id=${q(ids.partner)} and (status<>'paused' or channel_authority<>'{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}'::jsonb)),
 'canonical',(select count(*) from public.integration_canonical_records where partner_id=${q(ids.partner)}),
 'usage',(select count(*) from public.ai_call_usage where partner_id=${q(ids.partner)})+(select count(*) from public.usage_events where partner_id=${q(ids.partner)})+(select count(*) from public.voice_usage_events where partner_id=${q(ids.partner)}),
 'live',(select count(*) from public.client_businesses where partner_id=${q(ids.partner)} and default_runtime_mode<>'sandbox')`)} rollback;`), "onboarding_race_final");
    for (const key of ["paused", "controlFacts", "legacyRaw", "legacyKnowledge", "ownerRaw", "ownerKnowledge", "preferenceRaw", "preferenceKnowledge", "preferenceSaved"]) assert.equal(final[key], true, "The onboarding concurrency result lost a scoped source/control invariant.");
    for (const key of ["legacyProgress", "ownerLoser", "preferenceProgress", "jobs", "approvals", "connections", "activation", "reviews", "unsafeAuthority", "canonical", "usage", "live"]) assert.equal(final[key], 0, "An onboarding race produced a partial or unauthorized effect.");
    assert.equal(final.controlReceipts, 1); assert.equal(final.ownerWinner, 1);
  } catch (error) { failure = error; }
  finally {
    await Promise.allSettled([...active]);
    try {
      const cleanup = readReport(await query(target, `begin; set local statement_timeout='10s'; set local lock_timeout='5s';
 delete from public.partners where id=${q(ids.partner)} and slug=${q(prefix)};
 delete from auth.users where (id=${q(ids.ownerA)} and email=${q(`${prefix}-a@synthetic.invalid`)}) or (id=${q(ids.ownerB)} and email=${q(`${prefix}-b@synthetic.invalid`)});
 commit; ${emit("onboarding_race_cleanup", `'remaining',(select count(*) from public.partners where id=${q(ids.partner)})+(select count(*) from public.client_businesses where partner_id=${q(ids.partner)})+(select count(*) from public.owner_onboarding_progress where partner_id=${q(ids.partner)})+(select count(*) from public.owner_workspace_preferences where partner_id=${q(ids.partner)})+(select count(*) from public.business_owner_commands where partner_id=${q(ids.partner)})+(select count(*) from public.business_workspace_profiles where partner_id=${q(ids.partner)})+(select count(*) from public.client_knowledge_profiles where partner_id=${q(ids.partner)})+(select count(*) from auth.users where id in(${q(ids.ownerA)},${q(ids.ownerB)}))+(select count(*) from auth.sessions where id in(${q(ids.sessionA)},${q(ids.sessionB)}))`)} `), "onboarding_race_cleanup");
      assert.equal(cleanup.remaining, 0, "Every exact onboarding concurrency fixture must be removed.");
    } catch (error) { if (failure) console.error("FAIL: onboarding race cleanup also failed."); else failure = error; }
  }
  if (failure) throw failure;
  console.log("PASS: four actual two-session onboarding cases; context receipt FK completed while actor/business waiter was observed, atomic full settings and cross-owner winners rejected stale partials with PT409, actual preference holder released the actor-first full-profile save; zero unauthorized effects and exact fixture cleanup.");
  return { cases: OWNER_ONBOARDING_CONCURRENCY_CASES, remainingFixtures: 0 };
}
