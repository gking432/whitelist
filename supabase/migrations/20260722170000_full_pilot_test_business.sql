-- Keep the seeded full-package business suitable for the internal real-pilot
-- walkthrough: external CRM delivery can be tested while Northstar retains a
-- mirrored record for side-by-side verification.

update public.client_businesses
set crm_operating_mode = 'mirror',
    client_portal_enabled = true,
    is_test_account = true,
    updated_at = now()
where slug = 'summit-home-services'
  and account_kind = 'managed_client';
