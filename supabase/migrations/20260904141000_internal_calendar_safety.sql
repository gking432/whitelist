alter table public.crm_appointments add column if not exists approval_id uuid references public.approval_items(id) on delete set null;
create unique index crm_appointments_approval_unique on public.crm_appointments(approval_id);

-- All writes, including direct CRM edits, serialize on the business row before
-- checking its single shared calendar. Adjacent intervals remain valid.
create or replace function public.guard_internal_calendar_overlap()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.end_at<=new.start_at then raise exception 'Appointment end must follow its start'; end if;
  if new.status in ('proposed','booked') then
    perform id from public.client_businesses where id=new.client_id for update;
    if exists(select 1 from public.crm_appointments where client_id=new.client_id and id<>new.id
      and status in ('proposed','booked') and start_at<new.end_at and end_at>new.start_at) then
      raise exception using errcode='23P01',message='This calendar time is no longer available';
    end if;
  end if;
  return new;
end;
$$;
create trigger guard_internal_calendar_overlap before insert or update of start_at,end_at,status,client_id
  on public.crm_appointments for each row execute function public.guard_internal_calendar_overlap();

create or replace function public.book_internal_approved_appointment(p_approval_id uuid)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.approval_items; result_id uuid; contact_id uuid; slot_start timestamptz; slot_end timestamptz; business_tz text;
begin
  select * into a from public.approval_items where id=p_approval_id for update;
  if not found or a.type<>'appointment_booking' or a.status not in ('approved','edited_and_approved')
    or a.proposed_payload->>'provider' is distinct from 'northstar_internal' or coalesce((a.proposed_payload->>'scenario_lab')::boolean,false) then
    raise exception 'A human-approved internal booking is required';
  end if;
  select id into result_id from public.crm_appointments where approval_id=a.id;
  if result_id is not null then return result_id; end if;
  if not exists(select 1 from public.client_businesses where id=a.client_id and partner_id=a.partner_id
    and crm_operating_mode in ('primary_crm','mirror','assist')) then raise exception 'The internal business calendar is not enabled'; end if;
  slot_start=(a.proposed_payload->'slot'->>'start_iso')::timestamptz;
  slot_end=(a.proposed_payload->'slot'->>'end_iso')::timestamptz;
  if slot_start is null or slot_end is null or slot_start<=now() or slot_end<=slot_start then raise exception 'The approved appointment time is invalid or has passed'; end if;
  select timezone into business_tz from public.client_businesses where id=a.client_id;
  if exists(select 1 from public.crm_availability_windows where client_id=a.client_id and active) and not exists(
    select 1 from public.crm_availability_windows where client_id=a.client_id and active
      and weekday=extract(dow from slot_start at time zone coalesce(business_tz,'America/New_York'))
      and (slot_start at time zone coalesce(business_tz,'America/New_York'))::date=(slot_end at time zone coalesce(business_tz,'America/New_York'))::date
      and (slot_start at time zone coalesce(business_tz,'America/New_York'))::time>=start_time
      and (slot_end at time zone coalesce(business_tz,'America/New_York'))::time<=end_time
      and extract(epoch from slot_end-slot_start)/60=appointment_minutes
  ) then raise exception 'The approved time no longer fits business availability'; end if;
  select id into contact_id from public.crm_contacts where client_id=a.client_id and partner_id=a.partner_id
    and ((email is not null and lower(email)=lower(a.proposed_payload->'contact'->>'email'))
      or (phone is not null and phone=a.proposed_payload->'contact'->>'phone')) limit 1;
  insert into public.crm_appointments(partner_id,client_id,contact_id,title,start_at,end_at,status,external_ref,approval_id)
    values(a.partner_id,a.client_id,contact_id,'Appointment',slot_start,slot_end,'booked','northstar-'||a.id,a.id) returning id into result_id;
  insert into public.crm_timeline_entries(partner_id,client_id,contact_id,kind,actor_type,title,ref_run_id,ref_approval_id)
    values(a.partner_id,a.client_id,contact_id,'appointment','ai_assistant','Appointment booked after human approval',a.workflow_run_id,a.id);
  return result_id;
end;
$$;
revoke all on function public.guard_internal_calendar_overlap(),public.book_internal_approved_appointment(uuid) from public,anon,authenticated;
grant execute on function public.book_internal_approved_appointment(uuid) to service_role;
