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
  support_phone,
  is_test_account
)
values (
  '10000000-0000-4000-8000-000000000001',
  'Acme Partner Operations',
  'acme-partner-operations',
  'trial',
  'local-dev',
  'https://example.test',
  'support@example.test',
  '555-0100',
  true
)
on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      status = excluded.status,
      plan_key = excluded.plan_key,
      website_url = excluded.website_url,
      support_email = excluded.support_email,
      support_phone = excluded.support_phone,
      is_test_account = excluded.is_test_account,
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
  partner_can_edit_client_data,
  account_kind,
  is_test_account
)
values (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Summit Home Services',
  'summit-home-services',
  'onboarding',
  'Home services',
  'mirror',
  'sandbox',
  'https://summit.example.test',
  'Morgan Lee',
  'morgan@summit.example.test',
  '555-0199',
  'America/Chicago',
  true,
  false,
  'managed_client',
  true
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

insert into public.partners (
  id, name, slug, status, plan_key, is_test_account
)
values (
  '10000000-0000-4000-8000-000000000002',
  'Beacon Partner Group',
  'beacon-partner-group',
  'trial',
  'local-dev',
  true
)
on conflict (id) do update
  set name = excluded.name,
      slug = excluded.slug,
      is_test_account = excluded.is_test_account,
      updated_at = now();

insert into public.client_businesses (
  id, partner_id, name, slug, status, industry,
  crm_operating_mode, default_runtime_mode, timezone,
  client_portal_enabled, partner_can_edit_client_data,
  primary_contact_name, primary_contact_email,
  account_kind, is_test_account
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
    'jordan@ridgeview.example.test',
    'managed_client',
    true
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
    'riley@lakeside.example.test',
    'managed_client',
    true
  )
on conflict (id) do update
  set name = excluded.name,
      status = excluded.status,
      account_kind = excluded.account_kind,
      is_test_account = excluded.is_test_account,
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

insert into public.partner_packages (
  id, partner_id, name, description, capabilities, is_archived, created_by
)
values (
  '12000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  'Full AI Operations',
  'Complete Northstar CRM, AI communications, voice, scheduling, reputation, reporting, and automation-pack suite.',
  '{
    "northstar_crm": true,
    "lead_intake": true,
    "crm_sync": true,
    "message_drafting": true,
    "approval_gated_sending": true,
    "ai_intake_routing": true,
    "quote_intelligence": true,
    "feedback_intelligence": true,
    "automation_packs": true,
    "website_ai_chat": true,
    "live_call_assistant": true,
    "live_scheduling_assistant": true,
    "ai_phone_answering": true,
    "appointment_booking": true,
    "review_requests": true,
    "reports_portal": true
  }'::jsonb,
  false,
  '00000000-0000-4000-8000-000000000002'
)
on conflict (id) do update
  set name = excluded.name,
      description = excluded.description,
      capabilities = excluded.capabilities,
      is_archived = false,
      updated_at = now();

update public.client_businesses
set package_id = '12000000-0000-4000-8000-000000000001',
    updated_at = now()
where id = '20000000-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
-- Demo onboarding for "Summit Home Services" (docs/22). Makes the seeded
-- client ready to demonstrate the moment you log in: approved knowledge the
-- AI answers from, the lead-handling workflows enabled (in sandbox / dry run
-- so nothing sends), and built-in CRM mode so leads land somewhere visible.
-- Fire the "Send a test lead" button on Summit's setup page and watch the
-- whole pipeline run. See docs/22-demo-walkthrough.md.

insert into public.client_knowledge_profiles (
  partner_id, client_id,
  business_description, services_offered, service_areas, business_hours,
  booking_hours_start, booking_hours_end, appointment_duration_minutes,
  emergency_rules, pricing_disclaimer, booking_rules, faq,
  escalation_rules, ai_disclosure, voice_disclosure_mode, updated_by
)
values (
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'Summit Home Services is a family-owned home services company handling plumbing, heating, and cooling for residential customers.',
  'Plumbing repairs, water heater install and repair, drain cleaning, furnace and AC repair, seasonal HVAC tune-ups.',
  'The greater Springfield metro area and surrounding suburbs within about 30 miles.',
  'Monday to Friday 8am to 6pm; Saturday 9am to 2pm; closed Sunday. Emergency line after hours.',
  9, 17, 60,
  'Active water leaks, no heat in freezing weather, and gas smells are emergencies: collect the address and phone, tell the caller to shut off water or gas if safe, and escalate for an immediate callback.',
  'We never quote an exact price without seeing the job. Give ranges only if they are in the approved knowledge; otherwise say a technician will confirm pricing on site.',
  'Book 60-minute visits during business hours. Confirm the address, the problem, and a callback number before proposing times.',
  '[{"q": "Do you charge for estimates?", "a": "Estimates for replacement work are free. Diagnostic visits for repairs have a service-call fee that applies toward the work if you proceed."}, {"q": "How soon can someone come out?", "a": "For emergencies we aim for same-day. For standard visits we usually have openings within a few business days."}]'::jsonb,
  'Escalate to a human for anything involving injury, property damage, billing disputes, or a caller who is upset or explicitly asks for a person.',
  'Hi, you have reached Summit Home Services. I am their AI assistant and can help you get booked in or take a message for the team.',
  'explicit',
  '00000000-0000-4000-8000-000000000002'
)
on conflict (client_id) do update
  set business_description = excluded.business_description,
      services_offered = excluded.services_offered,
      service_areas = excluded.service_areas,
      business_hours = excluded.business_hours,
      emergency_rules = excluded.emergency_rules,
      pricing_disclaimer = excluded.pricing_disclaimer,
      booking_rules = excluded.booking_rules,
      faq = excluded.faq,
      escalation_rules = excluded.escalation_rules,
      ai_disclosure = excluded.ai_disclosure,
      updated_at = now();

-- Enable the core lead-handling workflows for Summit, in sandbox (dry run).
insert into public.client_workflow_instances (
  partner_id, client_id, template_id, name, status, runtime_mode, created_by
)
select
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  t.id,
  t.name,
  'active',
  'sandbox',
  '00000000-0000-4000-8000-000000000002'
from public.workflow_templates t
where t.template_key in (
  'ai_intake_router',
  'appointment_reminder',
  'estimate_follow_up',
  'missed_call_rescue',
  'new_lead_intake',
  'review_request',
  'sync_failure_alert'
)
on conflict (client_id, template_id) do nothing;

-- ---------------------------------------------------------------------------
-- Northstar CRM operating-suite sample data for Summit. These records make
-- every CRM view useful immediately while remaining unmistakably local test
-- data. Customer-facing communication is still sandboxed.

insert into public.crm_availability_windows (
  id, partner_id, client_id, weekday, start_time, end_time,
  appointment_minutes, label
)
values
  ('28000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, '08:00', '17:00', 60, 'Monday service window'),
  ('28000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 2, '08:00', '17:00', 60, 'Tuesday service window'),
  ('28000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 3, '08:00', '17:00', 60, 'Wednesday service window'),
  ('28000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 4, '08:00', '17:00', 60, 'Thursday service window'),
  ('28000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 5, '08:00', '17:00', 60, 'Friday service window')
on conflict (id) do update
  set start_time = excluded.start_time,
      end_time = excluded.end_time,
      appointment_minutes = excluded.appointment_minutes,
      label = excluded.label,
      active = true;

insert into public.crm_contacts (
  id, partner_id, client_id, first_name, last_name, email, phone, address,
  company_name, preferred_channel, tags, source, created_by
)
values
  (
    '21000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Taylor', 'Reed', 'taylor.reed@example.test', '555-0114',
    '18 River Bend, Springfield', null, 'sms',
    array['test', 'emergency'], 'website',
    '00000000-0000-4000-8000-000000000003'
  ),
  (
    '21000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Casey', 'Morgan', 'casey.morgan@example.test', '555-0115',
    '440 Oak Street, Springfield', null, 'email',
    array['test', 'estimate'], 'referral',
    '00000000-0000-4000-8000-000000000003'
  ),
  (
    '21000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    'Jordan', 'Blake', 'jordan.blake@example.test', '555-0116',
    '902 Cedar Lane, Springfield', 'Blake Design Co.', 'phone',
    array['test', 'maintenance'], 'phone',
    '00000000-0000-4000-8000-000000000003'
  )
on conflict (id) do update
  set first_name = excluded.first_name,
      last_name = excluded.last_name,
      email = excluded.email,
      phone = excluded.phone,
      address = excluded.address,
      company_name = excluded.company_name,
      preferred_channel = excluded.preferred_channel,
      tags = excluded.tags,
      source = excluded.source;

insert into public.crm_leads (
  id, partner_id, client_id, contact_id, status, title, service_type,
  description, source_event_type, urgency, quality, summary,
  estimated_value_min, estimated_value_max, next_action, last_contact_at
)
values
  (
    '22000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    'new', 'Emergency leak repair', 'Plumbing',
    'TEST: Active leak under the kitchen sink; customer shut off the local valve.',
    'form.submitted', 'urgent', 'high',
    'Urgent plumbing lead with complete contact and service-address details.',
    450, 950, 'Call immediately and confirm water is contained.',
    now() - interval '12 minutes'
  ),
  (
    '22000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
    'quoted', 'AC replacement estimate', 'HVAC replacement',
    'TEST: Replace an aging three-ton central AC system before peak season.',
    'estimate.created', 'normal', 'high',
    'Qualified replacement opportunity awaiting estimate follow-up.',
    6800, 9200, 'Follow up on the estimate tomorrow morning.',
    now() - interval '2 days'
  ),
  (
    '22000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003',
    'scheduled', 'Seasonal HVAC tune-up', 'HVAC maintenance',
    'TEST: Annual cooling-system maintenance visit.',
    'call.completed', 'normal', 'medium',
    'Existing customer booked for preventive maintenance.',
    149, 249, 'Complete the scheduled visit.',
    now() - interval '1 day'
  )
on conflict (id) do update
  set status = excluded.status,
      title = excluded.title,
      service_type = excluded.service_type,
      description = excluded.description,
      urgency = excluded.urgency,
      quality = excluded.quality,
      summary = excluded.summary,
      estimated_value_min = excluded.estimated_value_min,
      estimated_value_max = excluded.estimated_value_max,
      next_action = excluded.next_action,
      last_contact_at = excluded.last_contact_at;

insert into public.crm_tasks (
  id, partner_id, client_id, contact_id, lead_id, title, description,
  priority, status, due_at, task_type, created_by
)
values
  (
    '23000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'Call Taylor about urgent leak',
    'TEST: Confirm the leak is contained and dispatch the nearest technician.',
    'urgent', 'open', now() + interval '20 minutes', 'urgent_callback',
    '00000000-0000-4000-8000-000000000003'
  ),
  (
    '23000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'Follow up on AC estimate',
    'TEST: Ask whether Casey has questions about equipment options.',
    'high', 'open', now() + interval '1 day', 'estimate_follow_up',
    '00000000-0000-4000-8000-000000000003'
  )
on conflict (id) do update
  set title = excluded.title,
      description = excluded.description,
      priority = excluded.priority,
      status = excluded.status,
      due_at = excluded.due_at,
      task_type = excluded.task_type;

insert into public.crm_appointments (
  id, partner_id, client_id, contact_id, lead_id, title, start_at, end_at,
  status, location, notes, source
)
values (
  '24000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000003',
  '22000000-0000-4000-8000-000000000003',
  'TEST: Jordan Blake HVAC tune-up',
  date_trunc('day', now()) + interval '2 days 10 hours',
  date_trunc('day', now()) + interval '2 days 11 hours',
  'booked',
  '902 Cedar Lane, Springfield',
  'Annual cooling-system maintenance.',
  'northstar'
)
on conflict (id) do update
  set title = excluded.title,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      status = excluded.status,
      location = excluded.location,
      notes = excluded.notes;

insert into public.crm_communications (
  id, partner_id, client_id, contact_id, lead_id, channel, direction, status,
  from_value, to_value, subject, body, ai_generated, human_approved, occurred_at
)
values
  (
    '25000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'form', 'inbound', 'received',
    'taylor.reed@example.test', 'Summit website', 'TEST urgent plumbing request',
    'TEST: Water is leaking under my kitchen sink. I shut off the valve but need help today.',
    false, false, now() - interval '12 minutes'
  ),
  (
    '25000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
    '22000000-0000-4000-8000-000000000002',
    'email', 'outbound', 'pending_approval',
    'Summit Home Services', 'casey.morgan@example.test',
    'Your AC replacement estimate',
    'TEST DRAFT: Hi Casey, I wanted to check whether you had any questions about the AC replacement options we discussed.',
    true, false, now() - interval '3 hours'
  ),
  (
    '25000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000003',
    'sms', 'outbound', 'delivered',
    'Summit Home Services', '555-0116', null,
    'TEST: Your HVAC tune-up is booked for the upcoming service window.',
    true, true, now() - interval '1 day'
  )
on conflict (id) do update
  set status = excluded.status,
      subject = excluded.subject,
      body = excluded.body,
      ai_generated = excluded.ai_generated,
      human_approved = excluded.human_approved,
      occurred_at = excluded.occurred_at;

insert into public.crm_quotes (
  id, partner_id, client_id, contact_id, lead_id, service_type, status,
  low_amount, high_amount, line_items, assumptions, notes, ai_summary, created_by
)
values (
  '26000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000002',
  '22000000-0000-4000-8000-000000000002',
  'HVAC replacement',
  'internal_ballpark',
  6800,
  9200,
  '[{"label":"Equipment and materials","amount":5200},{"label":"Labor and commissioning","amount":2100}]'::jsonb,
  array['Final equipment sizing requires an on-site load calculation', 'Permit costs vary by jurisdiction'],
  'TEST: Internal range only; technician confirms final scope.',
  'Ballpark range for a standard three-ton replacement with normal site access.',
  '00000000-0000-4000-8000-000000000003'
)
on conflict (id) do update
  set low_amount = excluded.low_amount,
      high_amount = excluded.high_amount,
      line_items = excluded.line_items,
      assumptions = excluded.assumptions,
      notes = excluded.notes,
      ai_summary = excluded.ai_summary;

insert into public.crm_feedback (
  id, partner_id, client_id, contact_id, source, rating, feedback_text,
  sentiment, risk_level, summary, suggested_internal_action,
  suggested_customer_response, tags, ai_status
)
values
  (
    '27000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003',
    'google_business_profile', 5,
    'TEST: The technician arrived on time, explained everything, and left the work area spotless.',
    'positive', 'low',
    'Customer praised punctuality, communication, and cleanliness.',
    'Share the feedback with the technician.',
    'Thank you for the thoughtful review. We are glad the visit was clear, timely, and tidy.',
    array['test', 'praise'], 'fallback'
  ),
  (
    '27000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000002',
    'manual', 2,
    'TEST: I have called twice about a follow-up question and have not heard back.',
    'negative', 'high',
    'Customer reports repeated failed attempts to get a follow-up response.',
    'Manager should call the customer today and review the communication history.',
    'I am sorry we missed your follow-up attempts. A manager is reviewing this now and will contact you today.',
    array['test', 'service_recovery'], 'fallback'
  )
on conflict (id) do update
  set rating = excluded.rating,
      feedback_text = excluded.feedback_text,
      sentiment = excluded.sentiment,
      risk_level = excluded.risk_level,
      summary = excluded.summary,
      suggested_internal_action = excluded.suggested_internal_action,
      suggested_customer_response = excluded.suggested_customer_response,
      tags = excluded.tags;

insert into public.crm_timeline_entries (
  id, partner_id, client_id, contact_id, lead_id, kind, actor_type,
  title, body
)
values
  (
    '29000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001',
    '22000000-0000-4000-8000-000000000001',
    'note', 'ai_assistant',
    'AI lead analysis',
    'Urgent plumbing lead. Address and callback number are present; immediate human follow-up recommended.'
  ),
  (
    '29000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000003',
    '22000000-0000-4000-8000-000000000003',
    'appointment', 'system',
    'Appointment booked',
    'TEST: Seasonal HVAC tune-up booked in the Northstar calendar.'
  )
on conflict (id) do update
  set title = excluded.title,
      body = excluded.body;
