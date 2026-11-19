# Effective owner conflict inventory

Current selected foundation definitions are integrated in `supabase/migrations/20261119025924_owner_foundation_conflicts.sql`: five replaced functions plus one new private trigger function. The coordinator verified the four original semantic-raise bodies are preserved exactly except7/1/3/1 literals, and only the resolved-history clause changes in the fifth. Actual isolated six-function catalog/ACL proof is pending CI. The full baseline scan and historical stop limits below remain source evidence.

Baseline scan: `eea134b3a4d9d17df7017d0ef5b3ae3ac671cdf6`; resumed review: `eb3fb374332204d6664cfbd8646b0fafae7d7f5d`. Static source evidence only; no database or HTTP acceptance claimed.

- 194 effective function signatures; 29 contain126 explicit semantic40001 raises (123 public +3 private already behind prior wrappers).
- Unapplied foundation: four effective bodies change twelve explicit semantic40001 literals to PT409; the existing INVOKER history guard changes only its resolved-history conflict, and one private authority decision trigger supplies nonblocking exact-scope locks. Root integrates/reviews the proposal.
- Actual owner/ACL catalog verification remains CI work; source has no explicit ALTER OWNER.
- In resumed scope: generic stale-authority approval predicate and required decision conflicts. Parked: all unrelated preparer/lifecycle/OAuth changes; raw direct-PATCH zero-row remains HTTP200 and is classified409 only by the app adapter.

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
The original coordinator saved the reference artifacts at the stop boundary. The resumed worker updated only these evidence artifacts and the new isolated SQL acceptance asset; it performed no migration execution, database grant change, backend termination or provider action.

## Stop checkpoint limits

Historical checkpoint: the owner stopped this work at the earlier worker-return boundary. At that time four production caller mappings, catalog owners/ACLs, resolved-history policy and the generic stale-authority decision gap remained unresolved. Fresh authorization resumed the bounded foundation below; only actual catalog/SQL/HTTP execution proof remains pending after the source review. The proposal remains outside the migration directory and must be integrated by the coordinator.


## Resumed foundation review

Fresh authorization resumes only the context/authority and required approval boundary from `eb3fb374332204d6664cfbd8646b0fafae7d7f5d`. The historical stop notes above describe the earlier checkpoint. The updated source proposal now includes the narrowly scoped private decision-time authority trigger; execution remains the coordinator's responsibility.

The four previously missing literal caller mappings are resolved: `save_intake_scheduling_offer`, `save_customer_rebooking_offer` use the dynamic service-role worker callback in `lib/agents/inquiry-progression.ts:195`; `propose_intake_booking`, `propose_customer_rebooking` use its adjacent callback at line196. Existing dynamic owner journey mappings are also explicit in JSON (`customer-journey-commands.ts:41,67,77,121`). These functions are reachable, remain service-only, and remain outside this foundation's SQL-code changes.

The private trigger first takes exact OLD-business `FOR KEY SHARE NOWAIT`, then exact OLD-settings `FOR SHARE NOWAIT`. Settings-only locking would invert against a context command holding business `FOR UPDATE` because enqueue's business foreign key needs KEY SHARE. Both acquisitions must fail promptly as fixed PT409 when busy. Only 55P03 is caught; actual backend 40001/40P01 propagate unchanged. Authenticated has no settings UPDATE privilege, so PG17's row-lock privilege rule requires this service-only private definer lookup; no browser table grant is added. The existing INVOKER resolution guard, outer RLS, payload immutability and actor checks remain.

Actual isolated SQL evidence is pending: `scripts/sql/owner-foundation-conflict-acceptance.sql` has nine rollback groups and a separate catalog report with actual signature, owner, security mode, configuration, role EXECUTE flags and enabled private trigger. The two-session race contract is `/tmp/owner-foundation-race-contract.sql`; root integrates bounded real-lock barriers. No local SQL, hosted write, provider call, retry bypass or migration execution was performed by this worker.
