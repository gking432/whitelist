-- Keep the database-backed setup UI aligned with the executable connector
-- catalog. Empty or overstated capabilities make setup promises misleading.

update public.integration_providers
set capabilities = case provider_key
  when 'twilio' then array['lead.webhook', 'message.create', 'message.webhook']
  when 'resend' then array['message.create']
  when 'google_calendar' then array['appointment.read', 'appointment.create']
  when 'northstar_web_chat' then array['lead.webhook', 'message.webhook']
  when 'generic_inbound_webhook' then array['lead.webhook']
  when 'generic_outbound_webhook' then array['customer.create', 'note.create']
  when 'universal_lead_email' then array['lead.webhook']
  when 'hubspot' then array[
    'customer.search', 'customer.create', 'customer.update', 'note.create'
  ]
  when 'gohighlevel' then array[
    'customer.search', 'customer.create', 'customer.update', 'note.create'
  ]
  else capabilities
end,
connector_status = 'contract_verified'
where provider_key in (
  'twilio',
  'resend',
  'google_calendar',
  'northstar_web_chat',
  'generic_inbound_webhook',
  'generic_outbound_webhook',
  'universal_lead_email',
  'hubspot',
  'gohighlevel'
);
