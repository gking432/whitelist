-- When a previously resolved condition returns, make the existing alert new
-- again and rebuild delivery work from the user's current preferences.

create or replace function public.requeue_reopened_client_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.resolved_at is null or new.resolved_at is not null then
    return new;
  end if;

  delete from public.client_notification_reads
  where notification_id = new.id;

  delete from public.client_notification_deliveries
  where notification_id = new.id;

  insert into public.client_notification_deliveries (
    notification_id,
    partner_id,
    client_id,
    user_id,
    channel,
    destination
  )
  select
    new.id,
    new.partner_id,
    new.client_id,
    membership.user_id,
    'email',
    profile.email
  from public.memberships membership
  join public.profiles profile on profile.id = membership.user_id
  left join public.client_notification_preferences preference
    on preference.client_id = membership.client_id
   and preference.user_id = membership.user_id
  where membership.client_id = new.client_id
    and membership.partner_id = new.partner_id
    and membership.status = 'active'
    and (new.target_user_id is null or new.target_user_id = membership.user_id)
    and coalesce(
      membership.client_job_role,
      case membership.role
        when 'client_owner' then 'owner'
        when 'client_manager' then 'manager'
        when 'client_viewer' then 'viewer'
        else 'staff'
      end
    ) = any(new.audience_roles)
    and coalesce(preference.email_enabled, true)
    and (not coalesce(preference.critical_only, false) or new.severity = 'critical')
    and profile.email <> '';

  insert into public.client_notification_deliveries (
    notification_id,
    partner_id,
    client_id,
    user_id,
    channel,
    destination
  )
  select
    new.id,
    new.partner_id,
    new.client_id,
    membership.user_id,
    'sms',
    preference.sms_phone
  from public.memberships membership
  join public.client_notification_preferences preference
    on preference.client_id = membership.client_id
   and preference.user_id = membership.user_id
  where membership.client_id = new.client_id
    and membership.partner_id = new.partner_id
    and membership.status = 'active'
    and (new.target_user_id is null or new.target_user_id = membership.user_id)
    and coalesce(
      membership.client_job_role,
      case membership.role
        when 'client_owner' then 'owner'
        when 'client_manager' then 'manager'
        when 'client_viewer' then 'viewer'
        else 'staff'
      end
    ) = any(new.audience_roles)
    and preference.sms_enabled
    and preference.sms_phone is not null
    and (not preference.critical_only or new.severity = 'critical');

  return new;
end;
$$;

drop trigger if exists requeue_reopened_client_notification
  on public.client_notifications;
create trigger requeue_reopened_client_notification
after update of resolved_at on public.client_notifications
for each row
when (old.resolved_at is not null and new.resolved_at is null)
execute function public.requeue_reopened_client_notification();

create or replace function public.resolve_reassigned_client_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.assigned_to is distinct from new.assigned_to
     and old.assigned_to is not null then
    update public.client_notifications
    set resolved_at = now()
    where client_id = new.client_id
      and source_type = 'approval'
      and source_id = new.id
      and kind = 'approval_assigned'
      and target_user_id = old.assigned_to
      and resolved_at is null;
  end if;

  return new;
end;
$$;

drop trigger if exists resolve_reassigned_client_approval
  on public.approval_items;
create trigger resolve_reassigned_client_approval
after update of assigned_to on public.approval_items
for each row execute function public.resolve_reassigned_client_approval();
