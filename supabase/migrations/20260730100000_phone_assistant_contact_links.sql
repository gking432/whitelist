-- Shared caller resolution for AI-answered and staff-assisted calls.
-- Northstar keeps a local mirror contact so the live assistant can render
-- immediately, while this link preserves the external CRM identity.

create table if not exists public.crm_contact_links (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  contact_id uuid not null references public.crm_contacts (id) on delete cascade,
  connection_id uuid not null references public.integration_connections (id) on delete cascade,
  provider_key text not null,
  external_contact_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, external_contact_id)
);

create index if not exists crm_contact_links_contact_idx
  on public.crm_contact_links (contact_id);
create index if not exists crm_contact_links_client_idx
  on public.crm_contact_links (client_id, provider_key);

drop trigger if exists set_crm_contact_links_updated_at on public.crm_contact_links;
create trigger set_crm_contact_links_updated_at
  before update on public.crm_contact_links
  for each row execute function public.set_updated_at();

alter table public.crm_contact_links enable row level security;

drop policy if exists "crm_contact_links_select_scoped"
  on public.crm_contact_links;
create policy "crm_contact_links_select_scoped"
on public.crm_contact_links
for select to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

grant select on public.crm_contact_links to authenticated;
grant all on public.crm_contact_links to service_role;
