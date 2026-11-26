-- Lead Response Pack v2: workflow templates become AI-capable with
-- deterministic fallback. Template keys are stable (existing client
-- instances keep working); triggers expand and versions bump to 2.

update public.workflow_templates
set
  name = 'AI Lead Intake Analysis',
  description = 'Analyzes inbound lead events (forms, new leads, missed calls, inbound email) with AI — urgency, lead quality, missing fields, summary, and a recommended next action. Falls back to rule-based analysis when AI is unavailable; runs are labeled accordingly.',
  version = 2,
  trigger_events = array['lead.created', 'form.submitted', 'missed_call.created', 'email.lead_received'],
  settings_schema = '{"fields":[{"key":"high_urgency_keywords","label":"High urgency keywords","type":"text","help":"Comma-separated keywords used by the rule-based fallback to mark a lead as high urgency."}]}'
where template_key = 'new_lead_intake';

update public.workflow_templates
set
  description = 'Drafts a customer-facing callback message (SMS or email) after a missed call, using AI with a rule-based template fallback. Always pauses for human approval before anything could be sent.',
  version = 2,
  trigger_events = array['call.missed', 'missed_call.created'],
  settings_schema = '{"fields":[{"key":"message_template","label":"Preferred message template","type":"textarea","help":"Optional starting point for drafts. Placeholders: {{name}}, {{business}}."}]}'
where template_key = 'missed_call_rescue';

update public.workflow_templates
set
  description = 'Drafts an estimate follow-up message using the customer/deal context from the inbound event, using AI with a rule-based template fallback. Approval-gated.',
  version = 2,
  trigger_events = array['estimate.sent', 'estimate.follow_up_due'],
  settings_schema = '{"fields":[{"key":"message_template","label":"Preferred message template","type":"textarea","help":"Optional starting point for drafts. Placeholders: {{name}}, {{business}}."}]}'
where template_key = 'estimate_follow_up';

update public.workflow_templates
set
  name = 'Appointment Confirmation / Reminder',
  description = 'Drafts an appointment confirmation or reminder when an appointment is booked or a reminder is due, using AI with a rule-based template fallback. Approval policy is configurable per client.',
  version = 2,
  trigger_events = array['appointment.created', 'appointment.booked', 'appointment.reminder_due'],
  settings_schema = '{"fields":[{"key":"message_template","label":"Preferred message template","type":"textarea","help":"Optional starting point for drafts. Placeholders: {{name}}, {{business}}, {{appointment_time}}."}]}'
where template_key = 'appointment_reminder';

update public.workflow_templates
set
  description = 'Drafts a review request when a job completes, using AI with a rule-based template fallback. Approval-gated.',
  version = 2,
  trigger_events = array['job.completed'],
  settings_schema = '{"fields":[{"key":"message_template","label":"Preferred message template","type":"textarea","help":"Optional starting point for drafts. Placeholders: {{name}}, {{business}}."}]}'
where template_key = 'review_request';
