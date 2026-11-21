-- Preserve every provider-facing result so approval and actual delivery are
-- visibly distinct to clients and partners.
alter table public.action_jobs
  add column if not exists outcome_detail text;
