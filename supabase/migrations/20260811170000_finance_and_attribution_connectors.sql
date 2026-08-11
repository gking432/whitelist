insert into public.integration_providers (
  provider_key, display_name, category, supports_inbound, supports_outbound,
  supports_oauth, supports_api_key, is_active, description, auth_strategy,
  capabilities, connector_status, docs_url, is_requestable
)
values
  ('quickbooks_online','QuickBooks Online','accounting',false,true,true,false,true,'Customers, invoices, payments, and payment status from QuickBooks Online.','oauth2',array['customer.read','customer.create','invoice.read','payment.read']::text[],'contract_verified','https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api',false),
  ('stripe','Stripe','payments',true,true,false,true,true,'Customers, invoices, payment status, and hosted payment links from Stripe.','api_key',array['customer.read','customer.create','invoice.read','payment.read','payment.create']::text[],'contract_verified','https://docs.stripe.com/api',false),
  ('square','Square','payments',true,true,true,false,true,'Customers, invoices, payment status, and hosted payment links from Square.','oauth2',array['customer.read','customer.create','invoice.read','payment.read','payment.create']::text[],'contract_verified','https://developer.squareup.com/reference/square',false),
  ('callrail','CallRail','call_tracking',true,false,false,true,true,'Attributed phone calls and tracked form leads from CallRail.','api_key',array['lead.read']::text[],'contract_verified','https://apidocs.callrail.com/',false)
on conflict (provider_key) do update set
  display_name=excluded.display_name, category=excluded.category,
  supports_inbound=excluded.supports_inbound, supports_outbound=excluded.supports_outbound,
  supports_oauth=excluded.supports_oauth, supports_api_key=excluded.supports_api_key,
  is_active=excluded.is_active, description=excluded.description,
  auth_strategy=excluded.auth_strategy, capabilities=excluded.capabilities,
  connector_status=excluded.connector_status, docs_url=excluded.docs_url,
  is_requestable=excluded.is_requestable;
