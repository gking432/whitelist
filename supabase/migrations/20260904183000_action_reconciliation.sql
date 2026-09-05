-- Reconciliation records a provider result; it never sends or books anything.
create or replace function public.reconcile_uncertain_action(
  p_job_id uuid, p_client_id uuid, p_partner_id uuid, p_actor_id uuid,
  p_status text, p_evidence text
) returns boolean language plpgsql security definer set search_path=public as $$
declare target public.action_jobs%rowtype;
begin
  if p_status is null or p_status not in ('succeeded','cancelled')
    or p_evidence is null or length(trim(p_evidence)) not between 20 and 1000 then
    raise exception 'A confirmed outcome and provider evidence are required';
  end if;
  if not exists(select 1 from public.memberships where user_id=p_actor_id
    and client_id=p_client_id and partner_id=p_partner_id and role='client_owner' and status='active') then
    raise exception 'Only the active business owner can reconcile a delivery';
  end if;
  select * into target from public.action_jobs where id=p_job_id and client_id=p_client_id
    and partner_id=p_partner_id for update;
  if not found or target.status <> 'uncertain' then return false; end if;
  update public.action_jobs set status=p_status, last_error=null,
    outcome_detail='Manually confirmed by the business owner: ' || trim(p_evidence)
    where id=target.id;
  insert into public.audit_events(actor_user_id,actor_role,partner_id,client_id,action,target_type,target_id,summary,metadata)
  values(p_actor_id,'client_owner',p_partner_id,p_client_id,'job.reconciled','action_job',target.id,
    'Business owner reconciled an uncertain provider result; no action was replayed.',
    jsonb_build_object('previous_status','uncertain','status',p_status,'evidence',trim(p_evidence)));
  return true;
end $$;
revoke all on function public.reconcile_uncertain_action(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reconcile_uncertain_action(uuid,uuid,uuid,uuid,text,text) to service_role;
