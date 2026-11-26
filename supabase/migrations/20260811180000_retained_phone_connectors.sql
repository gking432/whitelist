insert into public.integration_providers (
  provider_key, display_name, category, supports_inbound, supports_outbound,
  supports_oauth, supports_api_key, is_active, description, auth_strategy,
  capabilities, connector_status, docs_url, is_requestable
)
values
  ('ringcentral', 'RingCentral', 'phone', true, false, true, false, true, 'Live call signals, SMS events, and call history from RingCentral.', 'oauth2', array['lead.read', 'lead.webhook', 'message.webhook']::text[], 'contract_verified', 'https://developers.ringcentral.com/guide', false),
  ('dialpad', 'Dialpad', 'phone', true, false, true, false, true, 'Live call and SMS events plus call history from Dialpad.', 'oauth2', array['lead.read', 'lead.webhook', 'message.webhook']::text[], 'contract_verified', 'https://developers.dialpad.com/docs', false),
  ('openphone', 'Quo / OpenPhone', 'phone', true, false, false, true, true, 'Call, message, transcript, and summary events from Quo.', 'api_key', array['lead.read', 'lead.webhook', 'message.webhook']::text[], 'contract_verified', 'https://www.quo.com/docs/mdx/api-reference', false)
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  auth_strategy = excluded.auth_strategy,
  capabilities = excluded.capabilities,
  connector_status = excluded.connector_status,
  docs_url = excluded.docs_url,
  is_requestable = excluded.is_requestable,
  supports_inbound = excluded.supports_inbound,
  supports_outbound = excluded.supports_outbound,
  supports_oauth = excluded.supports_oauth,
  supports_api_key = excluded.supports_api_key,
  is_active = true;
