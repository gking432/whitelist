-- Durable agent assignments reuse business/CRM records and the existing action outbox.
create table public.agent_team_settings (
 client_id uuid primary key, partner_id uuid not null,
 status text not null default 'paused' check(status in ('active','paused')),
 sales_enabled boolean not null default false, operations_enabled boolean not null default false,
 scheduled_reviews boolean not null default false,
 lead_stale_hours integer not null default 24 check(lead_stale_hours between 1 and 720),
 next_review_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade
);
create table public.agent_work_items (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 parent_id uuid,
 kind text not null check(kind in ('business_request','sales_review','operations_review','lead_follow_up','replenish_product','owner_briefing')),
 agent_key text not null,
 title text not null check(length(title) between 1 and 180),
 status text not null default 'queued' check(status in ('queued','running','waiting_children','waiting_approval','waiting_external','completed','blocked','cancelled')),
 input jsonb not null default '{}' check(jsonb_typeof(input)='object'),
 result jsonb not null default '{}' check(jsonb_typeof(result)='object'),
 summary text not null default '', dedupe_key text not null check(length(dedupe_key) between 1 and 300),
 source_lead_id uuid references public.crm_leads(id), source_record_id uuid,
 approval_id uuid references public.approval_items(id), result_record_id uuid,
 next_run_at timestamptz not null default now(), claim_token uuid, lease_until timestamptz,
 attempts integer not null default 0, revision integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,partner_id,client_id), unique(client_id,dedupe_key),
 foreign key(partner_id,client_id) references public.client_businesses(partner_id,id) on delete cascade,
 foreign key(parent_id,partner_id,client_id) references public.agent_work_items(id,partner_id,client_id),
 foreign key(source_record_id,partner_id,client_id) references public.business_records(id,partner_id,client_id),
 foreign key(result_record_id,partner_id,client_id) references public.business_records(id,partner_id,client_id),
 check(parent_id is distinct from id)
);
create table public.agent_work_events (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null, client_id uuid not null,
 work_id uuid not null, status text not null, summary text not null, created_at timestamptz not null default now(),
 foreign key(work_id,partner_id,client_id) references public.agent_work_items(id,partner_id,client_id) on delete cascade
);
create index agent_work_due on public.agent_work_items(next_run_at) where status in ('queued','waiting_children','waiting_approval','waiting_external');
create index agent_work_client_date on public.agent_work_items(client_id,created_at desc);
create index agent_work_parent on public.agent_work_items(parent_id);
create index agent_work_approval on public.agent_work_items(approval_id) where approval_id is not null;
create index agent_work_events_scope on public.agent_work_events(client_id,created_at desc);
create index agent_work_events_work on public.agent_work_events(work_id);
create index agent_work_lead on public.agent_work_items(source_lead_id) where source_lead_id is not null;
create index agent_work_source_record on public.agent_work_items(source_record_id) where source_record_id is not null;
create index agent_work_result_record on public.agent_work_items(result_record_id) where result_record_id is not null;

do $$ declare tab text; begin
 foreach tab in array array['agent_team_settings','agent_work_items','agent_work_events'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from anon,authenticated',tab);
  execute format('grant select on public.%I to authenticated',tab);
  execute format('grant all on public.%I to service_role',tab);
  execute format('create policy agent_owner_read on public.%I for select to authenticated using (public.current_user_has_platform_role() or public.current_user_has_client_role(client_id,array[''client_owner'']::public.membership_role[]) or (public.current_user_has_client_role(client_id,array[''client_manager'']::public.membership_role[]) and public.current_user_client_sections(client_id,array[''settings'']) and public.current_user_client_sections(client_id,array[''marketing'']) and public.current_user_client_sections(client_id,array[''tasks'']) and public.current_user_client_sections(client_id,array[''contacts'']) and public.current_user_client_sections(client_id,array[''automations'']) and public.current_user_client_sections(client_id,array[''action-center''])))',tab);
 end loop;
end $$;

create function public.audit_agent_work() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 if new.source_lead_id is not null and not exists(select 1 from public.crm_leads where id=new.source_lead_id and partner_id=new.partner_id and client_id=new.client_id) then raise exception 'Lead scope mismatch'; end if;
 if new.approval_id is not null and not exists(select 1 from public.approval_items where id=new.approval_id and partner_id=new.partner_id and client_id=new.client_id) then raise exception 'Approval scope mismatch'; end if;
 if tg_op='INSERT' or new.summary is distinct from old.summary or (new.status is distinct from old.status and new.status in ('completed','blocked','cancelled')) then
  insert into public.agent_work_events(partner_id,client_id,work_id,status,summary)
  values(new.partner_id,new.client_id,new.id,new.status,coalesce(nullif(new.summary,''),'Assigned: '||new.title));
 end if;
 return new;
end $$;
create trigger audit_agent_work after insert or update on public.agent_work_items for each row execute function public.audit_agent_work();

create function public.create_agent_work(p_partner uuid,p_client uuid,p_kind text,p_title text,p_key text,p_input jsonb default '{}',p_parent uuid default null,p_lead uuid default null,p_record uuid default null)
returns uuid language plpgsql security invoker set search_path=public as $$
declare result_id uuid; assigned text;
begin
 if not exists(select 1 from public.agent_team_settings where partner_id=p_partner and client_id=p_client and status='active') then raise exception 'Activate the agent team first'; end if;
 if p_parent is not null then
  perform 1 from public.agent_work_items where id=p_parent and partner_id=p_partner and client_id=p_client and status='running' for update;
  if not found then raise exception 'Parent assignment is no longer running'; end if;
 end if;
 assigned:=case p_kind when 'business_request' then 'executive' when 'owner_briefing' then 'executive' when 'sales_review' then 'sales_manager' when 'lead_follow_up' then 'sales_followup' when 'operations_review' then 'operations_manager' when 'replenish_product' then 'purchasing' end;
 if assigned is null then raise exception 'Unsupported agent task'; end if;
 insert into public.agent_work_items(partner_id,client_id,parent_id,kind,agent_key,title,dedupe_key,input,source_lead_id,source_record_id)
 values(p_partner,p_client,p_parent,p_kind,assigned,p_title,p_key,p_input,p_lead,p_record)
 on conflict(client_id,dedupe_key) do nothing returning id into result_id;
 if result_id is null then select id into result_id from public.agent_work_items where client_id=p_client and partner_id=p_partner and dedupe_key=p_key; end if;
 return result_id;
end $$;

create function public.claim_agent_work(p_partner uuid default null,p_client uuid default null)
returns setof public.agent_work_items language plpgsql security invoker set search_path=public as $$
declare selected uuid;
begin
 -- This worker only proposes internal effects. Committed proposal links and stable
 -- request keys make recovery safe; external effects stay in the existing outbox.
 update public.agent_work_items set status=case when attempts>=3 then 'blocked' else 'queued' end,
  summary='Interrupted internal work; '||case when attempts>=3 then 'review before retrying.' else 'resuming saved assignment.' end,
  claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
 where status='running' and lease_until<now() and (p_client is null or client_id=p_client) and (p_partner is null or partner_id=p_partner);
 select w.id into selected from public.agent_work_items w join public.agent_team_settings s on s.client_id=w.client_id and s.partner_id=w.partner_id
 join public.client_businesses c on c.id=w.client_id and c.partner_id=w.partner_id
 where s.status='active' and c.status='active' and w.status in ('queued','waiting_children','waiting_approval','waiting_external')
 and w.next_run_at<=now() and (p_client is null or w.client_id=p_client) and (p_partner is null or w.partner_id=p_partner)
 and (w.kind not in ('sales_review','lead_follow_up') or s.sales_enabled)
 and (w.kind not in ('operations_review','replenish_product') or s.operations_enabled)
 order by w.next_run_at,w.created_at for update of w skip locked limit 1;
 if selected is null then return; end if;
 return query update public.agent_work_items set status='running',claim_token=gen_random_uuid(),lease_until=now()+interval '5 minutes',
 attempts=case when status='queued' then attempts+1 else attempts end,revision=revision+1,updated_at=now()
 where id=selected returning *;
end $$;

create function public.finish_agent_work(p_id uuid,p_claim uuid,p_status text,p_summary text,p_result jsonb default '{}',p_delay integer default 60)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 if p_status not in ('waiting_children','waiting_approval','waiting_external','completed','blocked','cancelled') then raise exception 'Invalid completion state'; end if;
 update public.agent_work_items set status=p_status,summary=left(p_summary,4000),result=p_result,
 next_run_at=now()+make_interval(secs=>greatest(15,least(p_delay,86400))),claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
 where id=p_id and claim_token=p_claim and status='running' and lease_until>now();
 return found;
end $$;

-- Rechecked before drafting, committing approval, and immediately before delivery.
create function public.agent_followup_check(p_work uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; l public.crm_leads; c public.crm_contacts;
begin
 select * into w from public.agent_work_items where id=p_work;
 if not found or w.kind<>'lead_follow_up' then return jsonb_build_object('allowed',false,'reason','Assignment is unavailable.'); end if;
 if w.status in ('cancelled','completed','blocked') then return jsonb_build_object('allowed',false,'reason','Assignment is not active.'); end if;
 if not exists(select 1 from public.agent_team_settings s join public.client_businesses b on b.id=s.client_id and b.partner_id=s.partner_id where s.client_id=w.client_id and s.partner_id=w.partner_id and s.status='active' and s.sales_enabled and b.status='active') then return jsonb_build_object('allowed',false,'reason','Sales team is paused.'); end if;
 select * into l from public.crm_leads where id=w.source_lead_id and client_id=w.client_id and partner_id=w.partner_id;
 if not found or l.status not in ('new','contacted','qualified','quoted') then return jsonb_build_object('allowed',false,'reason','Lead is no longer open for follow-up.'); end if;
 if l.updated_at is distinct from (w.input->>'lead_updated_at')::timestamptz then return jsonb_build_object('allowed',false,'reason','Lead changed; review its current context before another follow-up.'); end if;
 select * into c from public.crm_contacts where id=l.contact_id and client_id=w.client_id and partner_id=w.partner_id;
 if not found or c.updated_at is distinct from (w.input->>'contact_updated_at')::timestamptz then return jsonb_build_object('allowed',false,'reason','Customer details changed or are unavailable.'); end if;
 if exists(select 1 from unnest(c.tags) t where lower(regexp_replace(t,'[ -]','_','g')) in ('do_not_contact','opt_out','opted_out','unsubscribed','stop'))
 or exists(select 1 from public.crm_communications m where m.client_id=w.client_id and m.partner_id=w.partner_id and m.contact_id=c.id and m.direction='inbound' and upper(btrim(m.body)) in ('STOP','STOPALL','UNSUBSCRIBE','CANCEL','END','QUIT','DO NOT CONTACT ME')) then
 return jsonb_build_object('allowed',false,'reason','Customer has an opt-out or do-not-contact record.'); end if;
 if exists(select 1 from public.crm_communications m where m.client_id=w.client_id and m.partner_id=w.partner_id and m.contact_id=c.id and m.occurred_at>(w.input->>'evaluated_at')::timestamptz and (m.direction='inbound' or (m.direction='outbound' and m.status='sent' and m.approval_id is distinct from w.approval_id))) then
 return jsonb_build_object('allowed',false,'reason','New conversation activity requires a fresh review.'); end if;
 if exists(select 1 from public.approval_items a where a.client_id=w.client_id and a.partner_id=w.partner_id and a.type='customer_message' and a.status='pending' and a.id is distinct from w.approval_id and a.proposed_payload->>'to' in (c.email,c.phone)) then
 return jsonb_build_object('allowed',false,'reason','Another customer message is already awaiting approval.'); end if;
 if w.created_at<now()-interval '3 days' then return jsonb_build_object('allowed',false,'reason','Follow-up context expired; request a fresh review.'); end if;
 return jsonb_build_object('allowed',true,'reason','Current customer and lead context verified.');
end $$;

create function public.propose_agent_followup(p_work uuid,p_claim uuid,p_channel text,p_subject text,p_body text)
returns uuid language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; c public.crm_contacts; a uuid; destination text; safety jsonb;
begin
 select * into w from public.agent_work_items where id=p_work for update;
 if not found or w.claim_token is distinct from p_claim or w.status<>'running' or w.lease_until<now() then raise exception 'Assignment lease expired'; end if;
 if w.approval_id is not null then return w.approval_id; end if;
 -- Serialize proposals for the same customer and freeze the reviewed lead.
 perform 1 from public.crm_leads where id=w.source_lead_id and client_id=w.client_id and partner_id=w.partner_id for update;
 select c1.* into c from public.crm_contacts c1 join public.crm_leads l on l.contact_id=c1.id where l.id=w.source_lead_id and c1.client_id=w.client_id and c1.partner_id=w.partner_id for update of c1;
 safety:=public.agent_followup_check(p_work);
 if not (safety->>'allowed')::boolean then raise exception '%',safety->>'reason'; end if;
 if p_channel not in ('sms','email') or length(btrim(p_body)) not between 1 and 5000 or length(p_subject)>200 then raise exception 'Invalid message draft'; end if;
 select c1.* into c from public.crm_contacts c1 join public.crm_leads l on l.contact_id=c1.id where l.id=w.source_lead_id and c1.client_id=w.client_id and c1.partner_id=w.partner_id;
 destination:=case when p_channel='email' then c.email else c.phone end;
 if nullif(btrim(destination),'') is null then raise exception 'Customer has no address for this channel'; end if;
 insert into public.approval_items(partner_id,client_id,type,status,title,summary,risk_level,editable_content,proposed_payload,expires_at)
 values(w.partner_id,w.client_id,'customer_message','pending',left(w.title,180),'Sales follow-up prepared from the current CRM record. Review before sending.','high',p_body,
 jsonb_build_object('channel',p_channel,'to',destination,'subject',p_subject,'draft_source','ai_generated','agent_work_id',w.id),now()+interval '3 days') returning id into a;
 insert into public.crm_communications(partner_id,client_id,contact_id,lead_id,approval_id,channel,direction,status,to_value,subject,body,ai_generated,human_approved,metadata)
 values(w.partner_id,w.client_id,c.id,w.source_lead_id,a,p_channel,'outbound','draft',destination,p_subject,p_body,true,false,jsonb_build_object('agent_work_id',w.id));
 update public.agent_work_items set approval_id=a,status='waiting_approval',summary='Follow-up drafted; waiting for owner approval.',claim_token=null,lease_until=null,next_run_at=now()+interval '1 minute',revision=revision+1,updated_at=now() where id=w.id;
 return a;
end $$;

create function public.prepare_agent_purchase(p_work uuid,p_claim uuid)
returns uuid language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; product public.business_records; prior public.business_records; purchase public.business_records; qty integer; inbound integer; cycle text; result_id uuid;
begin
 select * into w from public.agent_work_items where id=p_work for update;
 if not found or w.kind<>'replenish_product' or w.claim_token is distinct from p_claim or w.status<>'running' or w.lease_until<now() then raise exception 'Assignment lease expired'; end if;
 if not exists(select 1 from public.agent_team_settings where client_id=w.client_id and partner_id=w.partner_id and status='active' and operations_enabled) then raise exception 'Operations team is paused'; end if;
 if w.result_record_id is not null then return w.result_record_id; end if;
 select * into product from public.business_records where id=w.source_record_id and partner_id=w.partner_id and client_id=w.client_id and kind='product' and status<>'archived' for update;
 if not found or product.revision is distinct from (w.input->>'product_revision')::integer then raise exception 'Inventory changed; run a fresh operations review'; end if;
 select coalesce(sum((data->>'quantity')::integer),0) into inbound from public.business_records where partner_id=w.partner_id and client_id=w.client_id and kind='purchase' and data->>'product_id'=product.id::text and status in ('draft','needs_approval','approved','ordered');
 qty:=case when (product.data->>'quantity')::integer<=(product.data->>'reorder_point')::integer then greatest(0,(product.data->>'target_stock')::integer-(product.data->>'quantity')::integer-inbound) else 0 end;
 if qty<=0 then
  perform public.finish_agent_work(w.id,p_claim,'completed','No purchase needed; current stock and open purchases cover the target.','{}');
  return null;
 end if;
 select * into prior from public.business_records where client_id=w.client_id and partner_id=w.partner_id and kind='purchase' and data->>'product_id'=product.id::text and status in ('rejected','archived','received') order by updated_at desc,id desc limit 1;
 cycle:=case when prior.id is null then 'initial' else prior.id::text||':'||prior.revision end;
 result_id:=public.create_business_record(w.partner_id,w.client_id,null,'purchase',left('Replenish '||product.title,180),'Review supplier, quantity, and total cost. No supplier order has been sent.',
  jsonb_build_object('supplier',coalesce(product.data->>'supplier',''),'quantity',qty,'unit_cost',coalesce((product.data->>'unit_cost')::numeric,0),'shipping',0,'product_id',product.id,'order_reference',''),
  'reorder:'||product.id||':'||product.revision||':'||cycle,product.id);
 select * into purchase from public.business_records where id=result_id;
 if purchase.status='draft' then perform public.transition_business_record(w.partner_id,w.client_id,null,result_id,purchase.revision,'submit',''); end if;
 update public.agent_work_items set result_record_id=result_id,status='waiting_approval',summary='Purchase proposal prepared; waiting for owner approval.',claim_token=null,lease_until=null,next_run_at=now()+interval '1 minute',revision=revision+1,updated_at=now() where id=w.id;
 return result_id;
end $$;

create function public.agent_sales_candidates(p_partner uuid,p_client uuid,p_hours integer,p_limit integer default 20)
returns setof public.crm_leads language sql security invoker set search_path=public as $$
 select l.* from public.crm_leads l join public.crm_contacts c on c.id=l.contact_id and c.client_id=l.client_id and c.partner_id=l.partner_id
 where l.partner_id=p_partner and l.client_id=p_client and l.status in ('new','contacted','qualified','quoted')
 and greatest(l.created_at,l.updated_at,coalesce(l.last_contact_at,l.created_at))<=now()-make_interval(hours=>greatest(1,least(p_hours,720)))
 and (nullif(btrim(c.email),'') is not null or nullif(btrim(c.phone),'') is not null)
 and not exists(select 1 from public.agent_work_items w where w.client_id=p_client and w.partner_id=p_partner and w.source_lead_id=l.id and (w.input->>'lead_updated_at')::timestamptz=l.updated_at)
 and not exists(select 1 from public.crm_communications m where m.client_id=p_client and m.partner_id=p_partner and m.contact_id=c.id and (m.direction='inbound' or m.status='sent') and m.occurred_at>now()-make_interval(hours=>greatest(1,least(p_hours,720))))
 order by l.updated_at,l.id limit greatest(1,least(p_limit,20));
$$;

create function public.control_agent_work(p_partner uuid,p_client uuid,p_id uuid,p_revision integer,p_action text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items;
begin
 select * into w from public.agent_work_items where id=p_id and partner_id=p_partner and client_id=p_client for update;
 if not found or w.revision<>p_revision then raise exception 'Assignment changed; refresh before continuing'; end if;
 if p_action='retry' and w.status='blocked' then
  update public.agent_work_items set status='queued',summary='Owner requested a recheck of saved work.',attempts=0,next_run_at=now(),claim_token=null,lease_until=null,revision=revision+1,updated_at=now() where id=w.id;
 elsif p_action='cancel' and w.status not in ('completed','cancelled') then
  with recursive descendants as (select id from public.agent_work_items where id=w.id union all select a.id from public.agent_work_items a join descendants d on a.parent_id=d.id where a.partner_id=p_partner and a.client_id=p_client)
  update public.agent_work_items set status='cancelled',summary='Owner stopped this assignment. Actions already accepted by an external provider are not undone.',claim_token=null,lease_until=null,revision=revision+1,updated_at=now()
  where id in (select id from descendants) and status not in ('completed','cancelled');
 else raise exception 'This assignment cannot perform that transition'; end if;
 return true;
end $$;

-- Commit delegation and the parent's tracking state together. A process crash
-- either leaves the original queued work or all of its children, never half a plan.
create function public.delegate_agent_work(p_work uuid,p_claim uuid,p_children jsonb,p_summary text,p_result jsonb default '{}')
returns boolean language plpgsql security invoker set search_path=public as $$
declare w public.agent_work_items; child jsonb; child_id uuid; ids jsonb := '[]';
begin
 select * into w from public.agent_work_items where id=p_work for update;
 if not found or w.status<>'running' or w.claim_token is distinct from p_claim or w.lease_until<now() then raise exception 'Assignment lease expired'; end if;
 if jsonb_typeof(p_children)<>'array' or jsonb_array_length(p_children)>20 then raise exception 'Invalid delegation'; end if;
 for child in select value from jsonb_array_elements(p_children) loop
  if not ((w.kind='business_request' and child->>'kind' in ('sales_review','operations_review','owner_briefing')) or (w.kind='sales_review' and child->>'kind'='lead_follow_up') or (w.kind='operations_review' and child->>'kind'='replenish_product')) then raise exception 'Unsupported delegation'; end if;
  child_id:=public.create_agent_work(w.partner_id,w.client_id,child->>'kind',child->>'title',child->>'key',coalesce(child->'input','{}'),w.id,(child->>'leadId')::uuid,(child->>'recordId')::uuid);
  ids:=ids||jsonb_build_array(child_id);
 end loop;
 if not public.finish_agent_work(w.id,p_claim,case when jsonb_array_length(ids)>0 then 'waiting_children' else 'completed' end,p_summary,p_result||jsonb_build_object('child_ids',ids)) then raise exception 'Delegation lost its lease'; end if;
 return true;
end $$;

create function public.agent_inventory_candidates(p_partner uuid,p_client uuid)
returns setof public.business_records language sql security invoker set search_path=public as $$
 select r.* from public.business_records r where r.partner_id=p_partner and r.client_id=p_client and r.kind='product' and r.status<>'archived'
 and not exists(select 1 from public.agent_work_items w where w.partner_id=p_partner and w.client_id=p_client and w.dedupe_key='stock:'||r.id||':'||r.revision)
 order by r.created_at limit 1000;
$$;

-- Service-only RPCs. Browser roles read scoped rows and use authorized app endpoints.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('audit_agent_work','create_agent_work','claim_agent_work','finish_agent_work','agent_followup_check','propose_agent_followup','prepare_agent_purchase','agent_sales_candidates','control_agent_work','delegate_agent_work','agent_inventory_candidates') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

insert into public.platform_schema_state(singleton,current_migration,applied_at) values(true,'20261003144749_agent_team_execution',now())
on conflict(singleton) do update set current_migration=excluded.current_migration,applied_at=excluded.applied_at;
