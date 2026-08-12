alter table public.integration_field_mappings
  drop constraint if exists integration_field_mappings_object_type_check,
  drop constraint if exists integration_field_mappings_native_field_check,
  drop constraint if exists integration_field_mappings_external_field_check,
  drop constraint if exists integration_field_mappings_transform_key_check;

alter table public.integration_field_mappings
  add constraint integration_field_mappings_object_type_check
    check (object_type in (
      'customer', 'lead', 'job', 'appointment', 'note',
      'message', 'invoice', 'payment', 'campaign', 'review'
    )),
  add constraint integration_field_mappings_native_field_check
    check (native_field ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,5}$'),
  add constraint integration_field_mappings_external_field_check
    check (external_field ~ '^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*){0,5}$'),
  add constraint integration_field_mappings_transform_key_check
    check (
      transform_key is null
      or transform_key in (
        'trim', 'lowercase', 'uppercase', 'phone_digits',
        'number', 'boolean', 'iso_datetime'
      )
    );

drop policy if exists "integration_field_mappings_insert_operators"
  on public.integration_field_mappings;
drop policy if exists "integration_field_mappings_update_operators"
  on public.integration_field_mappings;
drop policy if exists "integration_field_mappings_delete_operators"
  on public.integration_field_mappings;

create policy "integration_field_mappings_insert_operators"
on public.integration_field_mappings for insert to authenticated
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_field_mappings_update_operators"
on public.integration_field_mappings for update to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
)
with check (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

create policy "integration_field_mappings_delete_operators"
on public.integration_field_mappings for delete to authenticated
using (
  public.current_user_has_platform_role(array[
    'platform_owner', 'platform_admin'
  ]::public.membership_role[])
  or public.current_user_has_partner_role(partner_id, array[
    'partner_owner', 'partner_admin', 'partner_implementer'
  ]::public.membership_role[])
);

insert into public.platform_schema_state (
  singleton,
  current_migration,
  applied_at
) values (
  true,
  '20260812053000_connector_field_mapping_runtime',
  now()
)
on conflict (singleton) do update
set current_migration = excluded.current_migration,
    applied_at = excluded.applied_at;
