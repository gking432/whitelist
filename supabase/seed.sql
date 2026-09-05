-- Minimal local inspection accounts.
-- No packages, integrations, workflows, CRM records, or activity are seeded.
--
-- Password for all local users: local-password-change-me

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
    'platform@northstar.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Platform Owner"}',
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
    'partner@northstar.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Partner Owner"}',
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
    'client@northstar.test',
    extensions.crypt('local-password-change-me', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"full_name":"Client Owner"}',
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
    '{"sub":"00000000-0000-4000-8000-000000000001","email":"platform@northstar.test"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000002',
    '{"sub":"00000000-0000-4000-8000-000000000002","email":"partner@northstar.test"}',
    'email',
    now(),
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000003',
    '{"sub":"00000000-0000-4000-8000-000000000003","email":"client@northstar.test"}',
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
  ('00000000-0000-4000-8000-000000000001', 'platform@northstar.test', 'Platform Owner'),
  ('00000000-0000-4000-8000-000000000002', 'partner@northstar.test', 'Partner Owner'),
  ('00000000-0000-4000-8000-000000000003', 'client@northstar.test', 'Client Owner')
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
  is_test_account
)
values (
  '10000000-0000-4000-8000-000000000001',
  'Partner Workspace',
  'partner-workspace',
  'trial',
  null,
  false
)
on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      plan_key = excluded.plan_key,
      is_test_account = excluded.is_test_account,
      updated_at = now();

insert into public.client_businesses (
  id,
  partner_id,
  name,
  slug,
  status,
  crm_operating_mode,
  client_experience_mode,
  default_runtime_mode,
  timezone,
  client_portal_enabled,
  partner_can_edit_client_data,
  account_kind,
  is_test_account
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Client Workspace',
  'client-workspace',
  'onboarding',
  'primary_crm',
  'northstar_crm',
  'sandbox',
  'America/Chicago',
  true,
  false,
  'managed_client',
  false
)
on conflict (id) do update
  set partner_id = excluded.partner_id,
      name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      crm_operating_mode = excluded.crm_operating_mode,
      client_experience_mode = excluded.client_experience_mode,
      default_runtime_mode = excluded.default_runtime_mode,
      timezone = excluded.timezone,
      client_portal_enabled = excluded.client_portal_enabled,
      partner_can_edit_client_data = excluded.partner_can_edit_client_data,
      account_kind = excluded.account_kind,
      is_test_account = excluded.is_test_account,
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
