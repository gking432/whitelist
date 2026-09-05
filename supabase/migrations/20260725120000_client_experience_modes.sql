-- A client either uses Northstar as its CRM home base or runs Northstar
-- services behind its existing systems.

alter table public.client_businesses
  add column if not exists client_experience_mode text
  not null default 'background_only';

alter table public.client_businesses
  drop constraint if exists client_businesses_experience_mode_check;

alter table public.client_businesses
  add constraint client_businesses_experience_mode_check
  check (client_experience_mode in ('background_only', 'northstar_crm'));

update public.client_businesses
set client_experience_mode = case
  when crm_operating_mode = 'primary_crm' then 'northstar_crm'
  else 'background_only'
end;
