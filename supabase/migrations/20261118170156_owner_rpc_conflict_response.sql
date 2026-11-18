-- Deterministic owner conflicts are HTTP409 decisions, not instructions to
-- retry the same transaction. PostgREST14 retries SQLSTATE40001 indefinitely.
-- Keep private actor/session/tenant/lock/receipt rules unchanged; translate at
-- these two authenticated public RPC boundaries, rolling back any failed call.
-- https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
create or replace function public.save_owner_workspace_preferences(p_client uuid,p_key uuid,p_revision bigint,p_settings jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
 return owner_onboarding.save_workspace_preferences(p_client,p_key,p_revision,p_settings);
exception when sqlstate '40001' then
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;
revoke all on function public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb) to authenticated,service_role;

create or replace function public.provision_first_owner(p_key uuid,p_business jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
begin
 return owner_onboarding.provision(p_key,p_business);
exception when sqlstate '40001' then
 raise sqlstate 'PT409' using message=sqlerrm;
end $$;
revoke all on function public.provision_first_owner(uuid,jsonb) from public,anon;
grant execute on function public.provision_first_owner(uuid,jsonb) to authenticated,service_role;

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261118170156_owner_rpc_conflict_response',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
