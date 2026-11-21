ALTER TABLE public.business_records DROP CONSTRAINT business_records_kind_check;
ALTER TABLE public.business_records ADD CONSTRAINT business_records_kind_check CHECK (kind = ANY (ARRAY['campaign'::text, 'opportunity'::text, 'supplier'::text, 'product'::text, 'purchase'::text, 'job'::text, 'knowledge'::text, 'brief'::text, 'quote'::text, 'invoice'::text, 'goal'::text]));

insert into public.platform_schema_state(singleton,current_migration,applied_at)
values(true,'20261031155701_desktop_daily_brief',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
