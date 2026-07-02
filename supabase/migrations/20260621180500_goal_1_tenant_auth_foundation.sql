-- Goal 1: tenant and auth foundation.
-- Creates core tenant tables, access helper functions, RLS policies, and audit storage.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $$
begin
  create type public.partner_status as enum ('active', 'trial', 'paused', 'suspended');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.client_status as enum ('onboarding', 'active', 'paused', 'at_risk', 'archived');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.membership_role as enum (
    'platform_owner',
    'platform_admin',
    'platform_support',
    'partner_owner',
    'partner_admin',
    'partner_implementer',
    'partner_viewer',
    'client_owner',
    'client_manager',
    'client_staff',
    'client_viewer'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.runtime_mode as enum ('sandbox', 'dry_run', 'live', 'paused');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.crm_operating_mode as enum (
    'external_crm_only',
    'mirror',
    'assist',
    'primary_crm',
    'webhook_only',
    'none'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partners (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status public.partner_status not null default 'trial',
  plan_key text,
  website_url text,
  support_email text,
  support_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_branding (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null unique references public.partners (id) on delete cascade,
  logo_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  portal_domain text,
  email_sender_name text,
  email_sender_domain text,
  report_footer_text text,
  support_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_businesses (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  name text not null,
  slug text not null,
  status public.client_status not null default 'onboarding',
  industry text,
  crm_operating_mode public.crm_operating_mode not null default 'webhook_only',
  default_runtime_mode public.runtime_mode not null default 'sandbox',
  website_url text,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  timezone text not null default 'America/Chicago',
  client_portal_enabled boolean not null default false,
  partner_can_edit_client_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_businesses_partner_slug_unique unique (partner_id, slug),
  constraint client_businesses_partner_id_id_unique unique (partner_id, id)
);

create table if not exists public.client_locations (
  id uuid primary key default extensions.gen_random_uuid(),
  partner_id uuid not null references public.partners (id) on delete cascade,
  client_id uuid not null references public.client_businesses (id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_locations_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.memberships (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  partner_id uuid references public.partners (id) on delete cascade,
  client_id uuid references public.client_businesses (id) on delete cascade,
  role public.membership_role not null,
  status text not null default 'active',
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_status_check check (status in ('active', 'invited', 'disabled')),
  constraint memberships_scope_check check (
    (
      role in ('platform_owner', 'platform_admin', 'platform_support')
      and partner_id is null
      and client_id is null
    )
    or (
      role in ('partner_owner', 'partner_admin', 'partner_implementer', 'partner_viewer')
      and partner_id is not null
      and client_id is null
    )
    or (
      role in ('client_owner', 'client_manager', 'client_staff', 'client_viewer')
      and partner_id is not null
      and client_id is not null
    )
  ),
  constraint memberships_client_scope_fk
    foreign key (partner_id, client_id)
    references public.client_businesses (partner_id, id)
    on delete cascade
);

create table if not exists public.audit_events (
  id uuid primary key default extensions.gen_random_uuid(),
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  partner_id uuid references public.partners (id) on delete set null,
  client_id uuid references public.client_businesses (id) on delete set null,
  action text not null,
  target_type text not null,
  target_id uuid,
  summary text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  metadata jsonb not null default '{}',
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists client_businesses_partner_id_idx on public.client_businesses (partner_id);
create index if not exists client_locations_partner_client_idx on public.client_locations (partner_id, client_id);
create index if not exists memberships_user_id_idx on public.memberships (user_id);
create index if not exists memberships_partner_id_idx on public.memberships (partner_id);
create index if not exists memberships_client_id_idx on public.memberships (client_id);
create index if not exists audit_events_partner_client_created_idx on public.audit_events (partner_id, client_id, created_at desc);
create index if not exists audit_events_actor_created_idx on public.audit_events (actor_user_id, created_at desc);

create unique index if not exists memberships_unique_platform_role
  on public.memberships (user_id, role)
  where partner_id is null and client_id is null;

create unique index if not exists memberships_unique_partner_role
  on public.memberships (user_id, partner_id, role)
  where partner_id is not null and client_id is null;

create unique index if not exists memberships_unique_client_role
  on public.memberships (user_id, partner_id, client_id, role)
  where partner_id is not null and client_id is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_partners_updated_at on public.partners;
create trigger set_partners_updated_at
before update on public.partners
for each row execute function public.set_updated_at();

drop trigger if exists set_partner_branding_updated_at on public.partner_branding;
create trigger set_partner_branding_updated_at
before update on public.partner_branding
for each row execute function public.set_updated_at();

drop trigger if exists set_client_businesses_updated_at on public.client_businesses;
create trigger set_client_businesses_updated_at
before update on public.client_businesses
for each row execute function public.set_updated_at();

drop trigger if exists set_client_locations_updated_at on public.client_locations;
create trigger set_client_locations_updated_at
before update on public.client_locations
for each row execute function public.set_updated_at();

drop trigger if exists set_memberships_updated_at on public.memberships;
create trigger set_memberships_updated_at
before update on public.memberships
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.current_user_has_platform_role(
  allowed_roles public.membership_role[] default array[
    'platform_owner',
    'platform_admin',
    'platform_support'
  ]::public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.partner_id is null
      and m.client_id is null
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.current_user_has_partner_role(
  target_partner_id uuid,
  allowed_roles public.membership_role[] default array[
    'partner_owner',
    'partner_admin',
    'partner_implementer',
    'partner_viewer'
  ]::public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.partner_id = target_partner_id
      and m.client_id is null
      and m.role = any(allowed_roles)
  );
$$;

create or replace function public.current_user_has_client_role(
  target_client_id uuid,
  allowed_roles public.membership_role[] default array[
    'client_owner',
    'client_manager',
    'client_staff',
    'client_viewer'
  ]::public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.memberships m
    join public.client_businesses c
      on c.id = m.client_id
     and c.partner_id = m.partner_id
    where m.user_id = auth.uid()
      and m.status = 'active'
      and m.client_id = target_client_id
      and m.role = any(allowed_roles)
      and c.client_portal_enabled = true
  );
$$;

create or replace function public.current_user_has_partner_client_role(
  target_partner_id uuid,
  target_client_id uuid,
  allowed_roles public.membership_role[] default array[
    'partner_owner',
    'partner_admin',
    'partner_implementer',
    'partner_viewer',
    'client_owner',
    'client_manager',
    'client_staff',
    'client_viewer'
  ]::public.membership_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.current_user_has_partner_role(target_partner_id, allowed_roles)
    or exists (
      select 1
      from public.memberships m
      join public.client_businesses c
        on c.id = m.client_id
       and c.partner_id = m.partner_id
      where m.user_id = auth.uid()
        and m.status = 'active'
        and m.partner_id = target_partner_id
        and m.client_id = target_client_id
        and m.role = any(allowed_roles)
        and c.client_portal_enabled = true
    );
$$;

alter table public.profiles enable row level security;
alter table public.partners enable row level security;
alter table public.partner_branding enable row level security;
alter table public.client_businesses enable row level security;
alter table public.client_locations enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles_select_accessible"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.current_user_has_platform_role()
);

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

create policy "profiles_update_self_or_platform"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  or public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
)
with check (
  id = auth.uid()
  or public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
);

create policy "partners_select_accessible"
on public.partners
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(id)
);

create policy "partners_insert_platform"
on public.partners
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
);

create policy "partners_update_authorized"
on public.partners
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "partner_branding_select_accessible"
on public.partner_branding
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
);

create policy "partner_branding_insert_authorized"
on public.partner_branding
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "partner_branding_update_authorized"
on public.partner_branding
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "client_businesses_select_accessible"
on public.client_businesses
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(id)
);

create policy "client_businesses_insert_authorized"
on public.client_businesses
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "client_businesses_update_authorized"
on public.client_businesses
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "client_locations_select_accessible"
on public.client_locations
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id)
  or public.current_user_has_client_role(client_id)
);

create policy "client_locations_insert_authorized"
on public.client_locations
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "client_locations_update_authorized"
on public.client_locations
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
);

create policy "memberships_select_accessible"
on public.memberships
for select
to authenticated
using (
  user_id = auth.uid()
  or public.current_user_has_platform_role()
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner',
    'partner_admin'
  ]::public.membership_role[])
  or public.current_user_has_client_role(client_id, array[
    'client_owner'
  ]::public.membership_role[])
);

create policy "memberships_insert_authorized"
on public.memberships
for insert
to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or (
    partner_id is not null
    and role not in ('platform_owner', 'platform_admin', 'platform_support')
    and public.current_user_has_partner_role(partner_id, array[
      'partner_owner',
      'partner_admin'
    ]::public.membership_role[])
  )
  or (
    client_id is not null
    and role in ('client_owner', 'client_manager', 'client_staff', 'client_viewer')
    and public.current_user_has_client_role(client_id, array[
      'client_owner'
    ]::public.membership_role[])
  )
);

create policy "memberships_update_authorized"
on public.memberships
for update
to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or (
    partner_id is not null
    and public.current_user_has_partner_role(partner_id, array[
      'partner_owner',
      'partner_admin'
    ]::public.membership_role[])
  )
  or (
    client_id is not null
    and public.current_user_has_client_role(client_id, array[
      'client_owner'
    ]::public.membership_role[])
  )
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner',
    'platform_admin'
  ]::public.membership_role[])
  or (
    partner_id is not null
    and role not in ('platform_owner', 'platform_admin', 'platform_support')
    and public.current_user_has_partner_role(partner_id, array[
      'partner_owner',
      'partner_admin'
    ]::public.membership_role[])
  )
  or (
    client_id is not null
    and role in ('client_owner', 'client_manager', 'client_staff', 'client_viewer')
    and public.current_user_has_client_role(client_id, array[
      'client_owner'
    ]::public.membership_role[])
  )
);

create policy "audit_events_select_accessible"
on public.audit_events
for select
to authenticated
using (
  public.current_user_has_platform_role()
  or (
    partner_id is not null
    and public.current_user_has_partner_role(partner_id)
  )
  or (
    client_id is not null
    and public.current_user_has_client_role(client_id, array[
      'client_owner'
    ]::public.membership_role[])
  )
);

create policy "audit_events_insert_actor_scope"
on public.audit_events
for insert
to authenticated
with check (
  actor_user_id = auth.uid()
  and (
    public.current_user_has_platform_role()
    or (
      partner_id is not null
      and public.current_user_has_partner_role(partner_id)
    )
    or (
      client_id is not null
      and public.current_user_has_client_role(client_id)
    )
  )
);

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.partners to authenticated;
grant select, insert, update on public.partner_branding to authenticated;
grant select, insert, update on public.client_businesses to authenticated;
grant select, insert, update on public.client_locations to authenticated;
grant select, insert, update on public.memberships to authenticated;
grant select, insert on public.audit_events to authenticated;
