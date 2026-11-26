-- Re-evaluate every open conflict in the client schedule whenever one
-- appointment changes, so moving either side clears both stale alerts.

create or replace function public.notify_client_appointment_conflict()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  conflicting_title text;
begin
  if new.status in ('proposed', 'booked') then
    select appointment.title into conflicting_title
    from public.crm_appointments appointment
    where appointment.client_id = new.client_id
      and appointment.id <> new.id
      and appointment.status in ('proposed', 'booked')
      and appointment.start_at < new.end_at
      and appointment.end_at > new.start_at
    order by appointment.start_at
    limit 1;
  end if;

  if conflicting_title is not null then
    perform public.upsert_client_notification(
      new.partner_id,
      new.client_id,
      'appointment_conflict',
      'critical',
      'Appointment conflict detected',
      new.title || ' overlaps with ' || conflicting_title || '.',
      'crm_appointment',
      new.id,
      '/client/crm?view=schedule',
      array['owner', 'manager', 'front_desk'],
      null,
      'appointment:' || new.id::text || ':conflict',
      new.created_at
    );
  else
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and dedupe_key = 'appointment:' || new.id::text || ':conflict'
      and resolved_at is null;
  end if;

  update public.client_notifications notification
  set resolved_at = now()
  where notification.client_id = new.client_id
    and notification.kind = 'appointment_conflict'
    and notification.source_type = 'crm_appointment'
    and notification.resolved_at is null
    and not exists (
      select 1
      from public.crm_appointments source
      join public.crm_appointments other
        on other.client_id = source.client_id
       and other.id <> source.id
       and other.status in ('proposed', 'booked')
       and other.start_at < source.end_at
       and other.end_at > source.start_at
      where source.id = notification.source_id
        and source.status in ('proposed', 'booked')
    );

  return new;
end;
$$;
