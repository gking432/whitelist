-- Completed calls, inbound SMS, completed website chats, manual entries,
-- and bridged GBP messages are all lead-bearing interactions. They should
-- receive the same analysis, CRM recording, and approval-gated first-response
-- treatment as forms and email leads.

update public.workflow_templates
set
  version = greatest(version, 3),
  requires_approval_default = true,
  trigger_events = array[
    'lead.created',
    'form.submitted',
    'missed_call.created',
    'email.lead_received',
    'email.received',
    'sms.received',
    'chat.conversation_completed',
    'call.completed',
    'gbp.message_received',
    'manual.lead_created'
  ]
where template_key = 'new_lead_intake';
