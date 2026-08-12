update public.client_businesses
set is_test_account = true
where slug = 'northstar-scenario-lab';

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812070000_classify_scenario_lab_accounts',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
