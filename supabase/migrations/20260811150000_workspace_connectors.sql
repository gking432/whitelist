insert into public.integration_providers (
  provider_key,
  display_name,
  category,
  supports_inbound,
  supports_outbound,
  supports_oauth,
  supports_api_key,
  is_active,
  description,
  auth_strategy,
  capabilities,
  connector_status,
  docs_url,
  is_requestable
)
values
  (
    'google_workspace', 'Google Workspace', 'productivity', false, true, true, false, true,
    'Google Contacts, Calendar, and Gmail through one authorization.', 'oauth2',
    array['customer.read','customer.create','appointment.read','appointment.create','appointment.update','appointment.delete','message.read','message.create']::text[],
    'contract_verified', 'https://developers.google.com/workspace', false
  ),
  (
    'microsoft_365', 'Microsoft 365', 'productivity', false, true, true, false, true,
    'Outlook Contacts, Calendar, and Mail through Microsoft Graph.', 'oauth2',
    array['customer.read','customer.create','customer.update','customer.delete','appointment.read','appointment.create','appointment.update','appointment.delete','message.read','message.create']::text[],
    'contract_verified', 'https://learn.microsoft.com/graph/overview', false
  )
on conflict (provider_key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  supports_inbound = excluded.supports_inbound,
  supports_outbound = excluded.supports_outbound,
  supports_oauth = excluded.supports_oauth,
  supports_api_key = excluded.supports_api_key,
  is_active = excluded.is_active,
  description = excluded.description,
  auth_strategy = excluded.auth_strategy,
  capabilities = excluded.capabilities,
  connector_status = excluded.connector_status,
  docs_url = excluded.docs_url,
  is_requestable = excluded.is_requestable;
