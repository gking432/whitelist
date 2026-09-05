-- Pilot stack providers (docs/13): HubSpot CRM, Twilio SMS, Google Calendar.
-- These are real, connectable providers with dedicated setup screens; the
-- credentials live encrypted in integration_secrets per connection.

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
  ('hubspot', 'HubSpot CRM', 'crm', false, true, false, true),
  ('twilio', 'Twilio SMS', 'sms', false, true, false, true),
  ('google_calendar', 'Google Calendar', 'calendar', false, true, true, false)
on conflict (provider_key) do update
  set display_name = excluded.display_name,
      category = excluded.category,
      supports_outbound = excluded.supports_outbound,
      supports_oauth = excluded.supports_oauth,
      supports_api_key = excluded.supports_api_key,
      is_active = true;

-- Outbound events grew new statuses for delivery logging.
alter table public.integration_events
  drop constraint if exists integration_events_status_check;

alter table public.integration_events
  add constraint integration_events_status_check
  check (status in ('received', 'processed', 'rejected', 'failed', 'skipped', 'sent', 'dry_run'));
