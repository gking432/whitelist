-- Local development seed data for Goal 1.
-- These accounts are only for a local Supabase instance.
--
-- Password for all seeded users: local-password-change-me
--
-- platform.owner@example.test -> platform_owner
-- partner.owner@example.test  -> partner_owner for Acme Partner Operations
-- client.owner@example.test   -> client_owner for Summit Home Services

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'platform.owner@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Platform Owner"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'partner.owner@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Partner Owner"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'client.owner@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Client Owner"}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  )
on conflict (id) do update
  set email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      raw_app_meta_data = excluded.raw_app_meta_data,
      raw_user_meta_data = excluded.raw_user_meta_data,
      updated_at = now();

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    '{"sub":"00000000-0000-4000-8000-000000000001","email":"platform.owner@example.test"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '{"sub":"00000000-0000-4000-8000-000000000002","email":"partner.owner@example.test"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    '{"sub":"00000000-0000-4000-8000-000000000003","email":"client.owner@example.test"}',
    'email',
    now(),
    now(),
    now()
  )
on conflict (provider_id, provider) do update
  set identity_data = excluded.identity_data,
      updated_at = now();

insert into public.profiles (id, email, full_name)
values
  ('00000000-0000-4000-8000-000000000001', 'platform.owner@example.test', 'Local Platform Owner'),
  ('00000000-0000-4000-8000-000000000002', 'partner.owner@example.test', 'Local Partner Owner'),
  ('00000000-0000-4000-8000-000000000003', 'client.owner@example.test', 'Local Client Owner')
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

insert into public.partners (
  id,
  name,
  slug,
  status,
  plan_key,
  website_url,
  support_email,
  support_phone
)
values (
  '10000000-0000-4000-8000-000000000001',
  'Acme Partner Operations',
  'acme-partner-operations',
  'trial',
  'local-dev',
  'https://example.test',
  'support@example.test',
  '555-0100'
)
on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      plan_key = excluded.plan_key,
      website_url = excluded.website_url,
      support_email = excluded.support_email,
      support_phone = excluded.support_phone,
      updated_at = now();

insert into public.partner_branding (
  id,
  partner_id,
  primary_color,
  secondary_color,
  accent_color,
  email_sender_name,
  report_footer_text,
  support_label
)
values (
  '11000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '#16685b',
  '#e7eee9',
  '#b85f24',
  'Acme Partner Operations',
  'Prepared by Acme Partner Operations',
  'Acme Support'
)
on conflict (partner_id) do update
  set primary_color = excluded.primary_color,
      secondary_color = excluded.secondary_color,
      accent_color = excluded.accent_color,
      email_sender_name = excluded.email_sender_name,
      report_footer_text = excluded.report_footer_text,
      support_label = excluded.support_label,
      updated_at = now();

insert into public.client_businesses (
  id,
  partner_id,
  name,
  slug,
  status,
  industry,
  crm_operating_mode,
  default_runtime_mode,
  website_url,
  primary_contact_name,
  primary_contact_email,
  primary_contact_phone,
  timezone,
  client_portal_enabled,
  partner_can_edit_client_data
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Summit Home Services',
  'summit-home-services',
  'onboarding',
  'Home services',
  'webhook_only',
  'sandbox',
  'https://summit.example.test',
  'Morgan Lee',
  'morgan@summit.example.test',
  '555-0199',
  'America/Chicago',
  true,
  false
)
on conflict (id) do update
  set partner_id = excluded.partner_id,
      name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      industry = excluded.industry,
      crm_operating_mode = excluded.crm_operating_mode,
      default_runtime_mode = excluded.default_runtime_mode,
      website_url = excluded.website_url,
      primary_contact_name = excluded.primary_contact_name,
      primary_contact_email = excluded.primary_contact_email,
      primary_contact_phone = excluded.primary_contact_phone,
      timezone = excluded.timezone,
      client_portal_enabled = excluded.client_portal_enabled,
      partner_can_edit_client_data = excluded.partner_can_edit_client_data,
      updated_at = now();

insert into public.memberships (id, user_id, partner_id, client_id, role, status)
values
  (
    '30000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000001',
    null,
    null,
    'platform_owner',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    null,
    'partner_owner',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'client_owner',
    'active'
  )
on conflict (id) do update
  set user_id = excluded.user_id,
      partner_id = excluded.partner_id,
      client_id = excluded.client_id,
      role = excluded.role,
      status = excluded.status,
      updated_at = now();

insert into public.audit_events (
  id,
  actor_user_id,
  actor_role,
  partner_id,
  client_id,
  action,
  target_type,
  target_id,
  summary,
  metadata
)
values (
  '40000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  'platform_owner',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'seed.local_dev_data_loaded',
  'client_business',
  '20000000-0000-4000-8000-000000000001',
  'Loaded local development tenant seed data.',
  '{"source":"supabase/seed.sql"}'
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Tenant isolation scenario data (docs/08-acceptance-verification.md).
-- Adds Partner B, additional clients, and additional partner roles so
-- cross-tenant access checks can be exercised locally.
--
-- partner.implementer@example.test -> partner_implementer for Acme
-- partner.viewer@example.test      -> partner_viewer for Acme
-- partnerb.owner@example.test      -> partner_owner for Beacon Partner Group
-- clienta2.owner@example.test      -> client_owner for Ridgeview Roofing
--                                     (portal disabled: login is denied)
-- ---------------------------------------------------------------------------

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
values
  (
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'partner.implementer@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Partner Implementer"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'partner.viewer@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Partner Viewer"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'partnerb.owner@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Partner B Owner"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'clienta2.owner@example.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Local Client A2 Owner"}',
    now(), now(), '', '', '', ''
  )
on conflict (id) do update
  set email = excluded.email,
      encrypted_password = excluded.encrypted_password,
      email_confirmed_at = excluded.email_confirmed_at,
      updated_at = now();

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    '{"sub":"00000000-0000-4000-8000-000000000004","email":"partner.implementer@example.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000005',
    '{"sub":"00000000-0000-4000-8000-000000000005","email":"partner.viewer@example.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000006',
    '{"sub":"00000000-0000-4000-8000-000000000006","email":"partnerb.owner@example.test"}',
    'email', now(), now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000007',
    '{"sub":"00000000-0000-4000-8000-000000000007","email":"clienta2.owner@example.test"}',
    'email', now(), now(), now()
  )
on conflict (provider_id, provider) do update
  set identity_data = excluded.identity_data,
      updated_at = now();

insert into public.profiles (id, email, full_name)
values
  ('00000000-0000-4000-8000-000000000004', 'partner.implementer@example.test', 'Local Partner Implementer'),
  ('00000000-0000-4000-8000-000000000005', 'partner.viewer@example.test', 'Local Partner Viewer'),
  ('00000000-0000-4000-8000-000000000006', 'partnerb.owner@example.test', 'Local Partner B Owner'),
  ('00000000-0000-4000-8000-000000000007', 'clienta2.owner@example.test', 'Local Client A2 Owner')
on conflict (id) do update
  set email = excluded.email,
      full_name = excluded.full_name,
      updated_at = now();

insert into public.partners (id, name, slug, status, plan_key)
values (
  '10000000-0000-4000-8000-000000000002',
  'Beacon Partner Group',
  'beacon-partner-group',
  'trial',
  'local-dev'
)
on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      updated_at = now();

insert into public.client_businesses (
  id, partner_id, name, slug, status, industry,
  crm_operating_mode, default_runtime_mode, timezone,
  client_portal_enabled, partner_can_edit_client_data,
  primary_contact_name, primary_contact_email
)
values
  (
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'Ridgeview Roofing',
    'ridgeview-roofing',
    'active',
    'Roofing',
    'external_crm_only',
    'sandbox',
    'America/Denver',
    false,
    false,
    'Jordan Casey',
    'jordan@ridgeview.example.test'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'Lakeside HVAC',
    'lakeside-hvac',
    'active',
    'HVAC',
    'webhook_only',
    'sandbox',
    'America/Chicago',
    false,
    false,
    'Riley Nolan',
    'riley@lakeside.example.test'
  )
on conflict (id) do update
  set name = excluded.name,
      status = excluded.status,
      updated_at = now();

insert into public.memberships (id, user_id, partner_id, client_id, role, status)
values
  (
    '30000000-0000-4000-8000-000000000004',
    '00000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001',
    null,
    'partner_implementer',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001',
    null,
    'partner_viewer',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000006',
    '00000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000002',
    null,
    'partner_owner',
    'active'
  ),
  (
    '30000000-0000-4000-8000-000000000007',
    '00000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'client_owner',
    'active'
  )
on conflict (id) do update
  set role = excluded.role,
      status = excluded.status,
      updated_at = now();
