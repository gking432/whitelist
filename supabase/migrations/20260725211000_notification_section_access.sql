-- Existing customized employee access predates the Notifications section.
-- Preserve every choice and append Notifications for operational roles.

update public.memberships
set client_permissions = jsonb_set(
  client_permissions,
  '{sections}',
  (client_permissions->'sections') || '["notifications"]'::jsonb,
  true
)
where client_id is not null
  and status = 'active'
  and jsonb_typeof(client_permissions->'sections') = 'array'
  and not (client_permissions->'sections' ? 'notifications')
  and coalesce(
    client_job_role,
    case role
      when 'client_owner' then 'owner'
      when 'client_manager' then 'manager'
      when 'client_viewer' then 'viewer'
      else 'staff'
    end
  ) <> 'viewer';
