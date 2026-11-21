-- Explicit opt-in; pre-existing records are never backfilled into outreach.
alter table public.client_businesses add column native_lifecycle_enabled_at timestamptz;
alter table public.crm_quotes add column lifecycle_sent_at timestamptz;
alter table public.crm_appointments add column lifecycle_completed_at timestamptz;

create or replace function public.guard_native_lifecycle_opt_in()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if (tg_op='INSERT' and new.native_lifecycle_enabled_at is not null)
    or (tg_op='UPDATE' and new.native_lifecycle_enabled_at is distinct from old.native_lifecycle_enabled_at) then
    if auth.role()='authenticated' and not (
      public.current_user_has_client_role(new.id,array['client_owner','client_manager']::public.membership_role[])
      and public.current_user_client_permission(new.id,'operate_customer_actions')
      and public.current_user_client_sections(new.id,array['settings'])) then
      raise exception 'A business owner or permitted manager must change native lifecycle automation';
    end if;
    if new.native_lifecycle_enabled_at is not null then new.native_lifecycle_enabled_at=now(); end if;
  end if;
  return new;
end $$;
create trigger guard_native_lifecycle_opt_in before insert or update on public.client_businesses
  for each row execute function public.guard_native_lifecycle_opt_in();

create or replace function public.stamp_native_crm_lifecycle()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_table_name='crm_quotes' then
    if new.status='sent' and (tg_op='INSERT' or old.status is distinct from 'sent') then
      new.lifecycle_sent_at=now();
    elsif tg_op='UPDATE' then new.lifecycle_sent_at=old.lifecycle_sent_at;
    else new.lifecycle_sent_at=null; end if;
  else
    if new.status='completed' and (tg_op='INSERT' or old.status is distinct from 'completed') then
      new.lifecycle_completed_at=now();
    elsif tg_op='UPDATE' then new.lifecycle_completed_at=old.lifecycle_completed_at;
    else new.lifecycle_completed_at=null; end if;
  end if;
  return new;
end $$;
create trigger stamp_native_quote_lifecycle before insert or update on public.crm_quotes
  for each row execute function public.stamp_native_crm_lifecycle();
create trigger stamp_native_appointment_lifecycle before insert or update on public.crm_appointments
  for each row execute function public.stamp_native_crm_lifecycle();

create or replace function public.native_crm_lifecycle_candidates(p_limit integer default 50)
returns table(partner_id uuid,client_id uuid,event_type text,idempotency_key text,payload jsonb)
language sql security definer set search_path=public,pg_temp as $$
  with candidates as (
    select a.partner_id,a.client_id,a.id as record_id,'appointment.reminder_due'::text as event_type,
      a.start_at as due_at,a.contact_id,
      jsonb_build_object('appointment_id',a.id,'appointment_time',to_char(a.start_at at time zone coalesce(c.timezone,'America/New_York'),'YYYY-MM-DD HH24:MI')||' '||coalesce(c.timezone,'America/New_York'),
        'start_at',a.start_at,'end_at',a.end_at,'service_type',a.title) as details
    from public.crm_appointments a join public.client_businesses c on c.id=a.client_id and c.partner_id=a.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and a.created_at>=c.native_lifecycle_enabled_at
      and a.status='booked' and a.start_at>now() and a.start_at<=now()+interval '24 hours'
    union all
    select q.partner_id,q.client_id,q.id,'estimate.follow_up_due',q.lifecycle_sent_at,q.contact_id,
      jsonb_build_object('estimate_id',q.id,'service_type',q.service_type,'low_amount',q.low_amount,'high_amount',q.high_amount)
    from public.crm_quotes q join public.client_businesses c on c.id=q.client_id and c.partner_id=q.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and q.created_at>=c.native_lifecycle_enabled_at
      and q.status='sent' and q.lifecycle_sent_at>=c.native_lifecycle_enabled_at and q.lifecycle_sent_at<=now()-interval '3 days'
    union all
    select a.partner_id,a.client_id,a.id,'job.completed',a.lifecycle_completed_at,a.contact_id,
      jsonb_build_object('appointment_id',a.id,'job_id',a.id,'service_type',a.title,'completed_at',a.lifecycle_completed_at)
    from public.crm_appointments a join public.client_businesses c on c.id=a.client_id and c.partner_id=a.partner_id
    where c.native_lifecycle_enabled_at is not null and c.status='active' and c.default_runtime_mode='live'
      and c.crm_operating_mode in ('primary_crm','mirror','assist') and a.created_at>=c.native_lifecycle_enabled_at
      and a.status='completed' and a.lifecycle_completed_at>=c.native_lifecycle_enabled_at
  )
  select x.partner_id,x.client_id,x.event_type,'native-crm:'||x.event_type||':'||x.record_id,
    x.details||jsonb_build_object('source','native_crm','contact_id',k.id,'name',trim(concat_ws(' ',k.first_name,k.last_name)),
      'phone',k.phone,'email',k.email)
  from candidates x join public.crm_contacts k on k.id=x.contact_id and k.client_id=x.client_id and k.partner_id=x.partner_id
  where (nullif(k.phone,'') is not null or nullif(k.email,'') is not null)
    and exists(select 1 from public.client_workflow_instances w join public.workflow_templates t on t.id=w.template_id
      where w.client_id=x.client_id and w.partner_id=x.partner_id and w.status='active' and w.runtime_mode='live'
      and x.event_type=any(t.trigger_events))
    and not exists(select 1 from public.integration_events e where e.partner_id=x.partner_id and e.client_id=x.client_id
      and e.connection_id is null and e.direction='inbound' and e.idempotency_key='native-crm:'||x.event_type||':'||x.record_id)
  order by x.due_at,x.record_id limit greatest(1,least(p_limit,100));
$$;
revoke all on function public.guard_native_lifecycle_opt_in(),public.stamp_native_crm_lifecycle(),public.native_crm_lifecycle_candidates(integer) from public,anon,authenticated;
grant execute on function public.native_crm_lifecycle_candidates(integer) to service_role;
