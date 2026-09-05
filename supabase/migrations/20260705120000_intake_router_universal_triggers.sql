-- docs/12: "Every inbound customer interaction should be classified before
-- workflows run." The router previously only listened to chat/email/sms/
-- call-completed events; new leads, form submissions, and missed calls are
-- inbound interactions too, so they route as well.

update public.workflow_templates
set trigger_events = array[
  'lead.created',
  'form.submitted',
  'missed_call.created',
  'email.lead_received',
  'chat.conversation_completed',
  'chat.message_received',
  'email.received',
  'sms.received',
  'call.completed',
  'call.missed',
  'gbp.message_received',
  'manual.lead_created'
]
where template_key = 'ai_intake_router';
