-- GoHighLevel as the second native CRM adapter.

insert into public.integration_providers (
  provider_key,
  display_name,
  category,
  supports_inbound,
  supports_outbound,
  supports_oauth,
  supports_api_key
)
values
  ('gohighlevel', 'GoHighLevel', 'crm', false, true, false, true)
on conflict (provider_key) do update
  set display_name = excluded.display_name,
      category = excluded.category,
      supports_outbound = excluded.supports_outbound,
      supports_api_key = excluded.supports_api_key,
      is_active = true;
