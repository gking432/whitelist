-- Per-client approved business knowledge for AI assistants (docs/12
-- "Website AI Chat Assistant" + "AI Phone Answering Disclosure Modes").
-- Chat, voice, and drafting prompts use ONLY this approved knowledge; the
-- AI is instructed never to invent services, pricing, guarantees, or
-- availability beyond it. One row per client.

create table if not exists public.client_knowledge_profiles (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  business_description text,
  services_offered text,
  service_areas text,
  business_hours text,
  -- Structured booking window used by the slot proposer.
  booking_hours_start integer not null default 9
    check (booking_hours_start between 0 and 23),
  booking_hours_end integer not null default 17
    check (booking_hours_end between 1 and 24),
  appointment_duration_minutes integer not null default 60
    check (appointment_duration_minutes between 15 and 480),
  emergency_rules text,
  pricing_disclaimer text,
  booking_rules text,
  -- [{"q": "...", "a": "..."}]
  faq jsonb not null default '[]'::jsonb,
  escalation_rules text,
  ai_disclosure text,
  voice_disclosure_mode text not null default 'explicit'
    check (voice_disclosure_mode in ('off', 'explicit', 'minimal')),
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_knowledge_profiles_client_unique unique (client_id)
);

drop trigger if exists set_client_knowledge_profiles_updated_at on public.client_knowledge_profiles;
create trigger set_client_knowledge_profiles_updated_at
  before update on public.client_knowledge_profiles
  for each row execute function public.set_updated_at();

alter table public.client_knowledge_profiles enable row level security;

drop policy if exists "client_knowledge_select_scoped" on public.client_knowledge_profiles;
create policy "client_knowledge_select_scoped"
on public.client_knowledge_profiles
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_partner_client_role(partner_id, client_id)
);

drop policy if exists "client_knowledge_insert_editors" on public.client_knowledge_profiles;
create policy "client_knowledge_insert_editors"
on public.client_knowledge_profiles
for insert
to authenticated
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_client_role(partner_id, client_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer',
    'client_owner', 'client_manager'
  ]::public.membership_role[])
);

drop policy if exists "client_knowledge_update_editors" on public.client_knowledge_profiles;
create policy "client_knowledge_update_editors"
on public.client_knowledge_profiles
for update
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_client_role(partner_id, client_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer',
    'client_owner', 'client_manager'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_client_role(partner_id, client_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer',
    'client_owner', 'client_manager'
  ]::public.membership_role[])
);

grant select, insert, update on public.client_knowledge_profiles to authenticated;
