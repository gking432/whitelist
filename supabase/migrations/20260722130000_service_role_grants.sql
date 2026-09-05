-- Trusted server paths use the Supabase service role for webhook intake,
-- workflow execution, provider delivery, and internal test orchestration.
-- BYPASSRLS does not itself grant table privileges, so make that access
-- explicit for the existing schema and preserve it for future migrations.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;

alter default privileges in schema public
  grant execute on functions to service_role;
