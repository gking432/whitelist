-- Feedback is now the reputation section inside the broader Marketing
-- analytics workspace. Preserve existing custom visibility assignments.
update public.memberships
set client_permissions = jsonb_set(
  client_permissions,
  '{sections}',
  (
    select coalesce(
      jsonb_agg(
        case
          when section = 'feedback' then to_jsonb('marketing'::text)
          else to_jsonb(section)
        end
      ),
      '[]'::jsonb
    )
    from jsonb_array_elements_text(client_permissions->'sections') as section
  ),
  true
)
where jsonb_typeof(client_permissions->'sections') = 'array'
  and client_permissions->'sections' ? 'feedback';
