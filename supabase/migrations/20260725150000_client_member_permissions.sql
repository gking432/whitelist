-- Client owners control which parts of the client workspace each employee
-- can see and which customer/CRM actions they can perform.

alter table public.memberships
  add column if not exists client_job_role text,
  add column if not exists client_permissions jsonb not null default '{}'::jsonb;

alter table public.memberships
  drop constraint if exists memberships_client_job_role_check;

alter table public.memberships
  add constraint memberships_client_job_role_check check (
    client_job_role is null
    or client_job_role in (
      'owner',
      'manager',
      'sales',
      'front_desk',
      'marketing',
      'staff',
      'viewer'
    )
  );

update public.memberships
set client_job_role = case role
  when 'client_owner' then 'owner'
  when 'client_manager' then 'manager'
  when 'client_viewer' then 'viewer'
  when 'client_staff' then 'staff'
  else client_job_role
end
where client_id is not null
  and client_job_role is null;

alter table public.memberships
  drop constraint if exists memberships_client_permissions_object_check;

alter table public.memberships
  add constraint memberships_client_permissions_object_check check (
    jsonb_typeof(client_permissions) = 'object'
  );
