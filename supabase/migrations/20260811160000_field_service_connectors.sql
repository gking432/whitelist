insert into public.integration_providers (
  provider_key, display_name, category, supports_inbound, supports_outbound,
  supports_oauth, supports_api_key, is_active, description, auth_strategy,
  capabilities, connector_status, docs_url, is_requestable
)
values
  ('jobber','Jobber','field_service',false,true,true,false,true,'Clients and jobs for Jobber businesses.','oauth2',array['customer.read','customer.create','job.read']::text[],'contract_verified','https://developer.getjobber.com/docs/',false),
  ('housecall_pro','Housecall Pro','field_service',false,true,false,true,true,'Customers and jobs for Housecall Pro businesses.','api_key',array['customer.read','customer.create','job.read']::text[],'contract_verified','https://docs.housecallpro.com/',false),
  ('servicetitan','ServiceTitan','field_service',false,true,false,true,true,'Customers, jobs, appointments, and lead intake for ServiceTitan.','api_key',array['customer.read','job.read','appointment.read','lead.create']::text[],'contract_verified','https://developer.servicetitan.io/docs/',false),
  ('workiz','Workiz','field_service',false,true,false,true,true,'Leads and jobs for Workiz businesses.','api_key',array['lead.read','lead.create','job.read']::text[],'contract_verified','https://developer.workiz.com/',false)
on conflict (provider_key) do update set
  display_name=excluded.display_name, category=excluded.category,
  supports_inbound=excluded.supports_inbound, supports_outbound=excluded.supports_outbound,
  supports_oauth=excluded.supports_oauth, supports_api_key=excluded.supports_api_key,
  is_active=excluded.is_active, description=excluded.description,
  auth_strategy=excluded.auth_strategy, capabilities=excluded.capabilities,
  connector_status=excluded.connector_status, docs_url=excluded.docs_url,
  is_requestable=excluded.is_requestable;
