insert into public.integration_providers (
  provider_key, display_name, category, supports_inbound, supports_outbound,
  supports_oauth, supports_api_key, is_active, description, auth_strategy,
  capabilities, connector_status, docs_url, is_requestable
)
values
  ('meta','Facebook and Instagram','lead_source',true,false,true,false,true,'Lead Ads, campaign performance, and attribution from Meta.','oauth2',array['lead.read','lead.webhook','campaign.read']::text[],'contract_verified','https://developers.facebook.com/docs/marketing-api/guides/lead-ads',false),
  ('google_ads','Google Ads and Local Services','lead_source',false,false,true,false,true,'Lead forms, campaign performance, spend, calls, and conversion outcomes from Google Ads.','oauth2',array['lead.read','campaign.read']::text[],'contract_verified','https://developers.google.com/google-ads/api/docs/start',false),
  ('google_business_profile','Google Business Profile','reputation',false,true,true,false,true,'Locations, customer reviews, ratings, and approved replies.','oauth2',array['review.read','review.update']::text[],'contract_verified','https://developers.google.com/my-business/reference/rest',false),
  ('universal_lead_email','Forwarded Lead Inbox','lead_source',true,false,false,false,true,'Private inbound address that parses forwarded marketplace and form leads.','managed',array['lead.webhook']::text[],'contract_verified','https://resend.com/docs/dashboard/receiving/introduction',false),
  ('podium','Podium','reputation',false,true,true,false,true,'Customer reviews and approval-gated responses from Podium.','oauth2',array['review.read','review.update']::text[],'contract_verified','https://docs.podium.com/reference',false),
  ('birdeye','Birdeye','reputation',false,false,false,true,true,'Aggregated customer reviews and ratings from Birdeye.','api_key',array['review.read']::text[],'contract_verified','https://developers.birdeye.com/',false)
on conflict (provider_key) do update set
  display_name=excluded.display_name, category=excluded.category,
  supports_inbound=excluded.supports_inbound, supports_outbound=excluded.supports_outbound,
  supports_oauth=excluded.supports_oauth, supports_api_key=excluded.supports_api_key,
  is_active=excluded.is_active, description=excluded.description,
  auth_strategy=excluded.auth_strategy, capabilities=excluded.capabilities,
  connector_status=excluded.connector_status, docs_url=excluded.docs_url,
  is_requestable=excluded.is_requestable;

create table if not exists public.marketing_campaign_snapshots (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  external_campaign_id text not null,
  source text not null,
  name text not null,
  status text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  spend numeric(14,2) not null default 0,
  conversions numeric(14,2) not null default 0,
  conversion_value numeric(14,2) not null default 0,
  raw_metrics jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_campaign_id)
);

create index if not exists marketing_campaign_snapshots_client_idx on public.marketing_campaign_snapshots (client_id, synced_at desc);
drop trigger if exists set_marketing_campaign_snapshots_updated_at on public.marketing_campaign_snapshots;
create trigger set_marketing_campaign_snapshots_updated_at before update on public.marketing_campaign_snapshots for each row execute function public.set_updated_at();
alter table public.marketing_campaign_snapshots enable row level security;
create policy "marketing_campaign_snapshots_select_scoped" on public.marketing_campaign_snapshots for select to authenticated using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id, array['client_owner','client_manager','client_staff','client_viewer']::public.membership_role[])
);
grant select on public.marketing_campaign_snapshots to authenticated;
grant all on public.marketing_campaign_snapshots to service_role;
