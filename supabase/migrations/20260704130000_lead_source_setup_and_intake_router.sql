-- Lead source setup wizard + universal AI intake routing foundation
-- (docs/12 "Lead Source Setup Options", "Universal AI Intake Routing",
-- "Website AI Chat Assistant").

-- Partner's plain-language setup answers and generated plan, stored per
-- client. Shape: { answers: {...}, saved_at: iso, completed_steps: [] }.
alter table public.client_businesses
  add column if not exists lead_source_profile jsonb not null default '{}';

-- Web chat intake provider: conversations from the (future) website chat
-- assistant land as inbound intake events on this connection today via the
-- same secured endpoint as generic webhooks. The chat widget itself ships
-- later; bridges can already post transcripts.
insert into public.integration_providers (
  provider_key,
  display_name,
  category,
  supports_inbound,
  supports_outbound,
  supports_api_key
)
values (
  'northstar_web_chat',
  'Northstar Web Chat Intake',
  'chat',
  true,
  false,
  true
)
on conflict (provider_key) do update
  set display_name = excluded.display_name,
      category = excluded.category,
      supports_inbound = excluded.supports_inbound,
      supports_api_key = excluded.supports_api_key;

-- Universal AI intake router: classifies every inbound interaction before
-- (and alongside) other workflows so routing, urgency, and ownership are
-- explicit. AI classification with deterministic keyword fallback; runs are
-- labeled accordingly.
insert into public.workflow_templates (
  template_key,
  name,
  description,
  category,
  version,
  risk_level,
  default_runtime_mode,
  requires_approval_default,
  trigger_events,
  required_provider_categories,
  settings_schema
)
values (
  'ai_intake_router',
  'AI Intake Routing',
  'Classifies every inbound interaction (chat, email, SMS, calls, manual entries) into sales, customer service, scheduling, estimate, urgent, billing/admin, review, PR/media, or spam — with AI and a rule-based fallback — so the right workflows and people see it.',
  'operations',
  1,
  'low',
  'sandbox',
  false,
  array[
    'chat.conversation_completed',
    'chat.message_received',
    'email.received',
    'sms.received',
    'call.completed',
    'gbp.message_received',
    'manual.lead_created'
  ],
  array[]::text[],
  '{"fields":[{"key":"urgent_keywords","label":"Urgent keywords","type":"text","help":"Comma-separated keywords the rule-based fallback treats as urgent/emergency."}]}'
)
on conflict (template_key) do update
  set name = excluded.name,
      description = excluded.description,
      trigger_events = excluded.trigger_events,
      settings_schema = excluded.settings_schema;
