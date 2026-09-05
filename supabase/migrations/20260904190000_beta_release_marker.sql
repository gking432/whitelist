-- Advertise readiness only after all beta safety, enrollment and lifecycle migrations.
insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20260904190000_beta_release_marker',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
