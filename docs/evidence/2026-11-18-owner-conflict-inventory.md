# Effective owner conflict inventory

Baseline: `eea134b3a4d9d17df7017d0ef5b3ae3ac671cdf6`. Static source evidence only; no database or HTTP acceptance claimed.

- 194 effective function signatures; 29 contain126 explicit semantic40001 raises (123 public +3 private already behind prior wrappers).
- Unapplied proposed foundation: 4 unchanged existing bodies,12 literal raises →PT409. Source-only draft; root integrates or discards.
- Actual owner/ACL catalog verification remains CI work; source has no explicit ALTER OWNER.
- Parked: generic stale-authority approval predicate, all unrelated preparer/lifecycle/OAuth domains, direct-PATCH zero-row transport semantics.

| Function | Current source | Direct EXECUTE | Scope |
|---|---|---|---|
| `owner_onboarding.provision(uuid,jsonb)` | supabase/migrations/20261118034811_first_owner_workspace.sql:123 | authenticated,service_role | already_translated_public_boundary |
| `owner_onboarding.save_workspace_preferences(uuid,uuid,bigint,jsonb)` | supabase/migrations/20261118051339_owner_workspace_preferences.sql:58 | authenticated,service_role | already_translated_public_boundary |
| `public.adopt_owner_intake_record(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117043720_owner_intake_adoption.sql:3 | service_role | parked |
| `public.apply_booking_lifecycle_command(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117133444_customer_journey_lifecycle.sql:517 | service_role | parked |
| `public.apply_business_activation(uuid,uuid,integer,jsonb,text)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:263 | service_role | parked |
| `public.apply_business_context_command(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117030202_reviewed_business_authority.sql:183 | service_role | proposed_foundation_literal_only |
| `public.begin_hubspot_oauth(uuid,uuid,uuid,uuid,text,text,text[],timestamp with time zone)` | supabase/migrations/20261118030334_hubspot_customer_system.sql:19 | service_role | parked |
| `public.configure_hubspot(uuid,uuid,uuid,text,boolean,boolean)` | supabase/migrations/20261118030334_hubspot_customer_system.sql:217 | service_role | parked |
| `public.enqueue_approved_action()` | supabase/migrations/20261118030334_hubspot_customer_system.sql:316 | service_role | proposed_foundation_literal_only |
| `public.finish_google_permission_upgrade(uuid,text,text,text,text,text[],text[])` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:19 | service_role | parked |
| `public.finish_hubspot_oauth(uuid,text,text,text,text,text[],text[],timestamp with time zone,uuid)` | supabase/migrations/20261118030334_hubspot_customer_system.sql:44 | service_role | parked |
| `public.finish_readonly_workspace_oauth(uuid,text,text,text,text)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:63 | service_role | parked |
| `public.guard_approval_resolution()` | supabase/migrations/20261117214644_approved_calendar_changes.sql:1357 | service_role | approval_default_conflict_policy_requires_root_decision |
| `public.guard_external_action_edit()` | supabase/migrations/20260904200000_embedded_app_connections.sql:94 | public,service_role | approval_default_conflict_policy_requires_root_decision |
| `public.guard_hubspot_approval()` | supabase/migrations/20261118030334_hubspot_customer_system.sql:302 | service_role | parked |
| `public.guard_invoice_followup_approval()` | supabase/migrations/20261118020030_invoice_followup_review.sql:130 | service_role | proposed_foundation_literal_only |
| `public.prepare_calendar_mutation(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:773 | service_role | parked |
| `public.prepare_hubspot_change(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261118030334_hubspot_customer_system.sql:252 | service_role | parked |
| `public.prepare_invoice_followup(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261118020030_invoice_followup_review.sql:83 | service_role | parked |
| `public.progress_owner_intake_inquiry(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117133444_customer_journey_lifecycle.sql:148 | service_role | parked |
| `public.propose_customer_rebooking(uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:228 | service_role | parked |
| `public.propose_intake_booking(uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:168 | service_role | parked |
| `public.provision_first_owner(uuid,jsonb)` | supabase/migrations/20261118170156_owner_rpc_conflict_response.sql:16 | authenticated,service_role | already_translated_public_boundary |
| `public.reconcile_calendar_change(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:550 | service_role | parked |
| `public.record_selected_workspace_check(uuid,uuid,integer,uuid,timestamp with time zone,timestamp with time zone,text,boolean,boolean)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:345 | service_role | parked |
| `public.review_customer_rebooking(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117214644_approved_calendar_changes.sql:1025 | service_role | parked |
| `public.save_calendar_change_handoff(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117214644_approved_calendar_changes.sql:481 | service_role | parked |
| `public.save_calendar_mutation_offer(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117214644_approved_calendar_changes.sql:251 | service_role | parked |
| `public.save_customer_rebooking_offer(uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:202 | service_role | parked |
| `public.save_intake_scheduling_offer(uuid,uuid,jsonb)` | supabase/migrations/20261117225829_google_permissions_calendar_reconciliation.sql:142 | service_role | parked |
| `public.save_owner_workspace_preferences(uuid,uuid,bigint,jsonb)` | supabase/migrations/20261118170156_owner_rpc_conflict_response.sql:6 | authenticated,service_role | already_translated_public_boundary |
| `public.select_customer_rebooking_slot(uuid,uuid,uuid,jsonb)` | supabase/migrations/20261117214644_approved_calendar_changes.sql:614 | service_role | parked |
| `public.stamp_approval_authority()` | supabase/migrations/20261117214644_approved_calendar_changes.sql:1343 | service_role | proposed_foundation_literal_only |

Details, exact raises/conditions, callers, last grants and RLS are in [2026-11-18-owner-conflict-inventory.json](2026-11-18-owner-conflict-inventory.json).
Draft: [2026-11-18-owner-conflict-proposal.sql](2026-11-18-owner-conflict-proposal.sql).
The inventory worker made no repository edits and performed no migration execution, grant change, new guard or backend termination. The coordinator saved these reference artifacts at the stop boundary.

## Stop checkpoint limits

The owner stopped this work at the worker-return boundary. This is a source inventory, not verified catalog or HTTP evidence. Four production caller mappings remain unresolved; actual catalog owners/ACLs still need isolated verification. The proposal is reference material outside the migration directory, not an executable or approved migration. It omits unresolved default-P0001 conflict policy and the generic stale-authority decision gap; do not apply it without completing that review.
