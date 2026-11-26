-- Human resolution and delivery intent commit together. Never replay an
-- interrupted external effect: its result must first be reconciled.
alter table public.action_jobs drop constraint if exists action_jobs_status_check;
alter table public.action_jobs add constraint action_jobs_status_check
  check (status in ('pending','processing','succeeded','dry_run','skipped','failed','cancelled','uncertain'));
alter table public.action_jobs add column if not exists execution_key text;
alter table public.action_jobs add column if not exists claim_token uuid;
alter table public.action_jobs add column if not exists claimed_at timestamptz;
alter table public.action_jobs add column if not exists external_ref text;
create unique index if not exists action_jobs_execution_key_idx on public.action_jobs(execution_key);

create or replace function public.guard_approval_resolution()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'pending' then
    raise exception 'Resolved approvals are immutable';
  end if;
  if (to_jsonb(new) - array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at'])
     is distinct from (to_jsonb(old) - array['status','resolved_by','resolved_at','resolved_content','resolution_note','updated_at']) then
    raise exception 'Only approval resolution fields may change';
  end if;
  if new.status not in ('approved','edited_and_approved','rejected') or new.resolved_by is null then
    raise exception 'A human resolution is required';
  end if;
  if auth.role() <> 'service_role' and new.resolved_by is distinct from auth.uid() then
    raise exception 'Resolution actor does not match authenticated user';
  end if;
  if new.status = 'approved' then new.resolved_content := old.editable_content; end if;
  if new.status = 'edited_and_approved' and nullif(btrim(new.resolved_content),'') is null then
    raise exception 'Edited content is required';
  end if;
  new.resolved_at := now();
  return new;
end $$;
create trigger guard_approval_resolution before update on public.approval_items
for each row execute function public.guard_approval_resolution();

create or replace function public.enqueue_approved_action()
returns trigger language plpgsql security definer set search_path = public as $$
declare action_kind text; action_payload jsonb;
begin
  if new.status not in ('approved','edited_and_approved') then return new; end if;
  if new.type = 'customer_message' and nullif(btrim(new.resolved_content),'') is not null
     and new.proposed_payload->>'channel' in ('sms','email') then
    action_kind := case when new.proposed_payload->>'channel' = 'email' then 'email.send' else 'sms.send' end;
    action_payload := coalesce(new.proposed_payload,'{}'::jsonb) || jsonb_build_object('body',new.resolved_content);
  elsif new.type = 'appointment_booking' then
    action_kind := 'calendar.book'; action_payload := coalesce(new.proposed_payload,'{}'::jsonb);
  else return new; end if;
  insert into public.action_jobs(partner_id,client_id,approval_id,workflow_run_id,kind,payload,status,execution_key)
  values(new.partner_id,new.client_id,new.id,new.workflow_run_id,action_kind,action_payload,'pending','approval:'||new.id)
  on conflict(execution_key) do nothing;
  return new;
end $$;
revoke all on function public.enqueue_approved_action() from public, anon, authenticated;
create trigger enqueue_approved_action after update on public.approval_items
for each row execute function public.enqueue_approved_action();

-- New event executions are unique; legacy duplicated history is preserved.
alter table public.workflow_runs add column if not exists execution_key text;
create unique index if not exists workflow_runs_execution_key_idx on public.workflow_runs(execution_key);
