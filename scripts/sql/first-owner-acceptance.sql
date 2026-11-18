-- Actual disposable database policy/RLS/session-row assertions. These synthetic
-- auth.sessions and request claims do NOT establish real email delivery, browser
-- sign-in or provider consent; the separate GoTrue/browser gate does that.
begin;
set local statement_timeout='45s';
set local lock_timeout='5s';
-- __ISOLATION_ASSERTION__
select pg_advisory_xact_lock(1937402189);
do $blank$ begin
 if current_database() !~ '_(test|acceptance)$' or exists(select 1 from public.partners) or exists(select 1 from public.client_businesses) or exists(select 1 from public.first_owner_signup_configuration) then raise exception 'First owner acceptance requires a blank disposable target'; end if;
end $blank$;
create temporary table fo_fixture(key text primary key,id uuid not null default extensions.gen_random_uuid(),data jsonb);
insert into fo_fixture(key) values('operator-a'),('operator-b'),('package-a'),('package-b'),('owner-a'),('owner-b'),('invited'),('disabled'),('unconfirmed'),('anonymous'),('banned'),('quota'),('billing-owner'),('foreign-client'),('existing-owner'),('session-owner-a'),('session-owner-b'),('session-invited'),('session-disabled'),('session-unconfirmed'),('session-anonymous'),('session-banned'),('session-quota'),('session-existing-owner');
grant select,insert,update on fo_fixture to authenticated,service_role,anon;
insert into auth.users(id,email,email_confirmed_at,is_anonymous,banned_until)
 select id,'cj-acceptance-__RUN_ID__-first-owner-'||key||'@synthetic.invalid',case when key='unconfirmed' then null else now() end,key='anonymous',case when key='banned' then now()+interval '1 day' end from fo_fixture where key in('owner-a','owner-b','invited','disabled','unconfirmed','anonymous','banned','quota','billing-owner','existing-owner');
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select f.id,(select actor.id from fo_fixture actor where actor.key=substring(f.key from 9)),now(),now(),now()+interval '1 hour' from fo_fixture f where f.key like 'session-%';
insert into public.partners(id,name,slug,status) select id,'Synthetic customer journey acceptance first owner '||key,'cj-acceptance-__RUN_ID__-first-owner-'||key,'active' from fo_fixture where key in('operator-a','operator-b');
insert into public.partner_packages(id,partner_id,name) select id,(select id from fo_fixture where key=case when f.key='package-a' then 'operator-a' else 'operator-b' end),'Synthetic first owner shared package' from fo_fixture f where key in('package-a','package-b');
insert into public.client_businesses(id,partner_id,package_id,name,slug,status,client_portal_enabled,default_runtime_mode)
 values((select id from fo_fixture where key='foreign-client'),(select id from fo_fixture where key='operator-b'),(select id from fo_fixture where key='package-b'),'Synthetic customer journey acceptance foreign business','cj-acceptance-__RUN_ID__-first-owner-foreign','active',true,'sandbox');
insert into public.memberships(user_id,partner_id,client_id,role,status) select id,(select id from fo_fixture where key='operator-b'),(select id from fo_fixture where key='foreign-client'),'client_owner',case when key='invited' then 'invited' when key='disabled' then 'disabled' else 'active' end from fo_fixture where key in('invited','disabled','existing-owner');
create function pg_temp.fo_claim(p_label text) returns void language plpgsql security invoker set search_path='' as $$
declare actor uuid:=(select id from pg_temp.fo_fixture where key=p_label); session_key uuid:=(select id from pg_temp.fo_fixture where key='session-'||p_label);
begin
 perform set_config('request.jwt.claim.role','authenticated',true);
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',actor,'session_id',session_key)::text,true);
end $$;
grant execute on function pg_temp.fo_claim(text) to authenticated;
-- Group 1: real grants, anonymous denial, and missing/wrong/revoked session rows.
do $grants$ declare f record; begin
 if has_table_privilege('authenticated','public.first_owner_signup_configuration','SELECT') or has_table_privilege('authenticated','public.first_owner_workspaces','INSERT') or has_table_privilege('anon','public.first_owner_workspaces','SELECT') then raise exception 'First owner privileged tables were exposed to a browser'; end if;
 for f in select p.oid::regprocedure signature from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_first_owner_entry','provision_first_owner','current_session_actor') loop
  if has_function_privilege('anon',f.signature,'EXECUTE') or not has_function_privilege('authenticated',f.signature,'EXECUTE') then raise exception 'First owner public RPC roles changed'; end if;
 end loop;
 if has_function_privilege('authenticated','public.configure_first_owner_signup(uuid,uuid,boolean)','EXECUTE') then raise exception 'A browser can select its operator/package'; end if;
end $grants$;
set local role anon;
do $anon$ declare denied boolean:=false; begin begin perform public.get_first_owner_entry(); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Anonymous entry was accepted'; end if; end $anon$;
reset role;
set local role authenticated;
select pg_temp.fo_claim('owner-a');
do $sessions$ declare denied boolean; label text; begin
 foreach label in array array['missing','wrong','unconfirmed','anonymous','banned'] loop
  if label in('unconfirmed','anonymous','banned') then perform pg_temp.fo_claim(label);
  else perform pg_temp.fo_claim('owner-a'); perform set_config('request.jwt.claims',jsonb_build_object('sub',(select id from fo_fixture where key='owner-a'),'role','authenticated','session_id',case when label='wrong' then (select id from fo_fixture where key='session-owner-b')::text else null end)::text,true); end if;
  denied:=false; begin perform public.get_first_owner_entry(); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Invalid first owner % session was accepted',label; end if;
 end loop;
 perform pg_temp.fo_claim('owner-a');
end $sessions$;
-- Group 2: a verified fresh owner sees configuration requirement, never creates
-- a partner, package, fake paid enrollment or a partially provisioned workspace.
do $missing_configuration$ declare denied boolean:=false; begin
 if public.get_first_owner_entry()->>'state' is distinct from 'setup_required' then raise exception 'Unconfigured signup did not explain setup requirement'; end if;
 begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Synthetic new business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when sqlstate 'P1101' then denied:=true; end;
 if not denied then raise exception 'Missing operator configuration created a business'; end if;
end $missing_configuration$;
reset role;
set local role service_role;
select public.configure_first_owner_signup((select id from fo_fixture where key='operator-a'),(select id from fo_fixture where key='package-a'),true);
reset role;
set local role authenticated;
select pg_temp.fo_claim('owner-a');
-- Group 3: actor/tenant/package/authority injection and unbounded details fail.
do $payload$ declare candidate jsonb; denied boolean; begin
 if public.current_session_actor() is distinct from (select id from fo_fixture where key='owner-a') then raise exception 'General server session actor differs from authenticated identity'; end if;
 if public.get_first_owner_entry()->>'state' is distinct from 'new' then raise exception 'Configured verified first owner was not eligible'; end if;
 foreach candidate in array array[
  '{"name":"Synthetic business","description":"A valid synthetic owner declaration","timezone":"America/Chicago","actorId":"spoofed"}'::jsonb,
  '{"name":"Synthetic business","description":"A valid synthetic owner declaration","timezone":"America/Chicago","partnerId":"spoofed"}'::jsonb,
  '{"name":"Synthetic business","description":"A valid synthetic owner declaration","timezone":"America/Chicago","packageId":"spoofed"}'::jsonb,
  '{"name":"Synthetic business","description":"A valid synthetic owner declaration","timezone":"America/Chicago","default_runtime_mode":"live"}'::jsonb,
  '{"name":"x","description":"too short","timezone":"Invalid/Zone"}'::jsonb,
  '{"name":null,"description":"A valid synthetic owner declaration","timezone":"America/Chicago"}'::jsonb
 ] loop
  denied:=false; begin perform public.provision_first_owner(extensions.gen_random_uuid(),candidate); exception when invalid_parameter_value then denied:=true; end;
  if not denied then raise exception 'Invalid first owner details were accepted'; end if;
 end loop;
end $payload$;
-- Group 4: narrow authenticated creation under the exact configured operator.
do $create_once$ declare receipt jsonb; begin
 receipt:=public.provision_first_owner((select id from fo_fixture where key='owner-a'),'{"name":" Synthetic owned business ","description":" Synthetic owner declaration only ","timezone":"America/Chicago"}');
 insert into fo_fixture(key,id,data) values('created',(receipt->>'clientId')::uuid,receipt);
 if receipt->>'partnerId' is distinct from (select id::text from fo_fixture where key='operator-a') or receipt->>'destination' is distinct from '/client/onboarding' or receipt->'replayed' is distinct from 'false'::jsonb or public.get_first_owner_entry()->>'state' is distinct from 'existing' then raise exception 'First owner receipt or normal portal routing is incorrect'; end if;
 if not exists(select 1 from public.client_businesses where id=(receipt->>'clientId')::uuid and package_id=(select id from fo_fixture where key='package-a') and account_kind='managed_client' and not is_test_account and status='active' and crm_operating_mode='external_crm_only' and default_runtime_mode='sandbox' and client_portal_enabled and not partner_can_edit_client_data) then raise exception 'First owner workspace bypassed normal sandbox/business security flags'; end if;
 if not exists(select 1 from public.memberships where user_id=(select id from fo_fixture where key='owner-a') and client_id=(receipt->>'clientId')::uuid and role='client_owner' and status='active') or exists(select 1 from public.memberships where user_id=(select id from fo_fixture where key='owner-a') and client_id is null) then raise exception 'Creation granted a partner/platform role'; end if;
end $create_once$;
-- Group 5: same request and different keys with the same normalized details
-- replay one active owner receipt; changed body never rewrites the business.
do $replay$ declare receipt jsonb; original jsonb:=(select data from fo_fixture where key='created'); denied boolean:=false; begin
 receipt:=public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Synthetic owned business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}');
 if receipt->>'id' is distinct from original->>'id' or receipt->>'clientId' is distinct from original->>'clientId' or receipt->'replayed' is distinct from 'true'::jsonb then raise exception 'A second signup key created another business'; end if;
 receipt:=public.provision_first_owner((select id from fo_fixture where key='owner-a'),'{"name":"Synthetic owned business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}');
 if receipt->>'id' is distinct from original->>'id' or receipt->'replayed' is distinct from 'true'::jsonb then raise exception 'A repeated signup key did not replay its receipt'; end if;
 begin perform public.provision_first_owner((select id from fo_fixture where key='owner-a'),'{"name":"Changed business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when sqlstate '40001' then denied:=true; end;
 if not denied then raise exception 'Changed signup payload rewrote an existing owner workspace'; end if;
end $replay$;
-- Group 6: foreign-tenant RLS and existing/invited/disabled identities cannot
-- obtain a second business; no first-owner table grants are widened.
do $scope$ declare denied boolean:=false; label text; begin
 if exists(select 1 from public.client_businesses where id=(select id from fo_fixture where key='foreign-client')) then raise exception 'New owner read a sibling tenant'; end if;
 begin perform 1 from public.first_owner_workspaces; exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Owner read private signup receipt storage directly'; end if;
 foreach label in array array['invited','disabled','existing-owner'] loop
  perform pg_temp.fo_claim(label); denied:=false;
  if public.get_first_owner_entry()->>'state' is distinct from (case when label='existing-owner' then 'existing' else 'blocked' end) then raise exception 'Existing % access was misclassified first owner',label; end if;
  begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Unwanted duplicate","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when insufficient_privilege then denied:=true; end;
  if not denied then raise exception 'Existing % identity created a new business',label; end if;
 end loop;
 perform pg_temp.fo_claim('owner-a');
end $scope$;
reset role;
-- Group 7: immutable creation facts stay paused/unreviewed with zero effects.
do $no_effects$ declare c uuid:=(select id from fo_fixture where key='created'); begin
 if not exists(select 1 from public.agent_team_settings where client_id=c and status='paused' and not scheduling_enabled and not conversations_enabled and channel_authority='{"website":"off","email":"off","sms":"off","instagram":"off","calendar":"off"}'::jsonb) or not exists(select 1 from public.business_workspace_profiles where client_id=c and profile->>'description'='Synthetic owner declaration only') then raise exception 'Creation lost declared context or conservative authority'; end if;
 if exists(select 1 from public.business_context_reviews where client_id=c) or exists(select 1 from public.business_agent_activation where client_id=c) or exists(select 1 from public.integration_connections where client_id=c) or exists(select 1 from public.action_jobs where client_id=c) or exists(select 1 from public.client_beta_acceptances where client_id=c) or exists(select 1 from public.partner_enrollments) then raise exception 'Creation fabricated review, activation, connection, outbound, beta acceptance or billing'; end if;
 if (select count(*) from public.partners)<>2 or (select count(*) from public.partner_packages)<>2 or (select count(*) from public.first_owner_workspaces)<>1 then raise exception 'Signup created extra operator/package/receipt rows'; end if;
end $no_effects$;
-- Group 8: ordinary live launch gate, revoked session and revoked membership
-- still block; deleting the business retains the actor receipt tombstone.
do $live_gate$ declare denied boolean:=false; begin
 begin update public.client_businesses set default_runtime_mode='live' where id=(select id from fo_fixture where key='created'); exception when raise_exception then denied:=true; end;
 if not denied then raise exception 'First-owner signup bypassed beta launch acceptance'; end if;
 update public.memberships set status='disabled' where user_id=(select id from fo_fixture where key='owner-a');
end $live_gate$;
set local role authenticated;
select pg_temp.fo_claim('owner-a');
do $revoked$ declare denied boolean:=false; begin
 if public.get_first_owner_entry()->>'state' is distinct from 'blocked' then raise exception 'Revoked first owner was reclassified new'; end if;
 begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Synthetic owned business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Signup replay restored revoked membership'; end if;
end $revoked$;
reset role;
delete from public.client_businesses where id=(select id from fo_fixture where key='created');
set local role authenticated;
select pg_temp.fo_claim('owner-a');
do $deleted$ declare denied boolean:=false; begin
 if public.get_first_owner_entry()->>'state' is distinct from 'blocked' then raise exception 'Deleted first-owner workspace erased signup history'; end if;
 begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Synthetic owned business","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when insufficient_privilege then denied:=true; end;
 if not denied then raise exception 'Deleted workspace signup was recreated'; end if;
end $deleted$;
reset role;
delete from auth.sessions where id=(select id from fo_fixture where key='session-owner-b');
set local role authenticated;
select pg_temp.fo_claim('owner-b');
do $ended_session$ declare denied boolean:=false; begin begin perform public.get_first_owner_entry(); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended Auth session still authorized signup'; end if;
 denied:=false; begin perform public.current_session_actor(); exception when insufficient_privilege then denied:=true; end; if not denied then raise exception 'Ended Auth session still authorized server access'; end if; end $ended_session$;
reset role;
-- Group 9: existing real enrollment/capacity triggers roll back every partial
-- owner creation. Synthetic billing state below is test input, not paid proof.
insert into public.partner_enrollments(owner_id,agency_name,partner_id,status) values((select id from fo_fixture where key='billing-owner'),'Synthetic operator billing fixture',(select id from fo_fixture where key='operator-b'),'pending');
set local role service_role;
select public.configure_first_owner_signup((select id from fo_fixture where key='operator-b'),(select id from fo_fixture where key='package-b'),true);
reset role;
set local role authenticated;
select pg_temp.fo_claim('quota');
do $billing$ declare denied boolean:=false; begin
 begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Blocked by billing","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when sqlstate 'P1001' then denied:=true; end;
 if not denied then raise exception 'Pending operator enrollment did not block workspace creation'; end if;
end $billing$;
reset role;
update public.partner_enrollments set status='active' where partner_id=(select id from fo_fixture where key='operator-b');
insert into public.client_businesses(partner_id,package_id,name,slug,default_runtime_mode) select (select id from fo_fixture where key='operator-b'),(select id from fo_fixture where key='package-b'),'Synthetic customer journey acceptance quota '||i,'cj-acceptance-__RUN_ID__-first-owner-quota-'||i,'sandbox' from generate_series(1,9) i;
set local role authenticated;
select pg_temp.fo_claim('quota');
do $capacity$ declare denied boolean:=false; begin
 begin perform public.provision_first_owner(extensions.gen_random_uuid(),'{"name":"Blocked by capacity","description":"Synthetic owner declaration only","timezone":"America/Chicago"}'); exception when sqlstate 'P1002' then denied:=true; end;
 if not denied then raise exception 'Full operator capacity did not block workspace creation'; end if;
end $capacity$;
reset role;
do $partial_rollback$ begin
 if exists(select 1 from public.first_owner_workspaces where user_id=(select id from fo_fixture where key='quota')) or exists(select 1 from public.memberships where user_id=(select id from fo_fixture where key='quota')) or exists(select 1 from public.client_businesses where name in('Blocked by billing','Blocked by capacity')) then raise exception 'Failed capacity/billing left partial first-owner rows'; end if;
 if (select count(*) from public.client_businesses where partner_id=(select id from fo_fixture where key='operator-b'))<>10 then raise exception 'Capacity failed to preserve exactly its existing ten clients'; end if;
end $partial_rollback$;
rollback;
select '__CUSTOMER_JOURNEY_REPORT__'::text || jsonb_build_object('kind','first_owner_acceptance','rolledBack',true,'remainingFixtures',(select count(*) from public.partners where slug like 'cj-acceptance-__RUN_ID__-first-owner-%')+(select count(*) from auth.users where email like 'cj-acceptance-__RUN_ID__-first-owner-%@synthetic.invalid'),'checks',jsonb_build_array('actual_rpc_grants_and_verified_current_session_rows','missing_operator_configuration_no_partial_provisioning','strict_owner_declaration_no_actor_tenant_or_authority_injection','exact_configured_operator_package_client_owner_only','idempotent_same_and_distinct_key_receipt_body_immutability','foreign_tenant_rls_existing_invited_and_disabled_access','paused_unreviewed_context_without_provider_billing_or_outbound_effects','normal_beta_gate_session_revocation_membership_and_deleted_receipt_history','normal_billing_capacity_triggers_and_atomic_partial_rollback'))::text as cj_report;
