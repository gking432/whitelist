# Supervised beta launch guide

Implementation status: September 4, 2026. This is a working beta candidate with local verification, not a claim that every integration has been verified with a real account. Changes are in the working tree on `codex/v1-scenario-lab`, based on `3b3cbbb9f87ece8322f932fb2043a412ece781a5`; they have not been deployed.

## The offer a partner can implement

Product direction clarified: partners should ultimately offer the full AI and automation suite across varied client systems. The first scenario below is a verification starting point, not a permanent restriction on the catalog. See [the adaptive solutions blueprint](29-adaptive-solutions-blueprint.md) for native, embedded, routed and other implementation methods.

Start with **AI receptionist and assisted follow-up** for one home-service business: capture inquiries, prepare replies, suggest appointments against available calendars, and let the business approve messages and bookings. Include the live staff assistant and desktop popup in the acceptance test. Add reminder, estimate-follow-up and review-request workflows after the core path passes. A callback request is not a live phone transfer.

The partner sells implementation and ongoing support under their brand. The business owns its customer decisions. Platform staff operate infrastructure and handle escalations. Avoid promising unattended operation, universal CRM synchronization, automatic live call transfer, or unlimited provider usage.

## The nontechnical partner journey

1. Visit `/join`, verify your email, and complete checkout when platform purchasing has been enabled. The existing plan is $1,000 setup plus $500/month for ten managed clients; phone, email and AI usage are separate. This is implemented pricing, not market validation. `/partner/billing` opens subscription management for self-service buyers. Existing manually provisioned beta partners keep their arrangement.
2. Open `/partner/start`. Upload your logo, set your product name and colors in Settings, and copy the branded client login link. The hosted client experience and agency login use your brand. Custom domains and a separate branded/signed desktop binary per agency are not included in this beta implementation.
3. Add the starter packages, rename an offer, and include only capabilities you have verified. Do not enable every advertised integration for the first client.
4. Add the business and invite its real owner. Ask: **“Do you already use a CRM?”** Keep the existing system if yes; use the built-in CRM if no. A lightweight portal still handles approvals, service status and support for clients retaining another CRM.
5. Follow the client's Setup page. The business connects its own accounts through the provided connection flow; never ask it to send passwords by email. Partner Twilio parent-account setup is needed for the Twilio offer, but is no longer compulsory just to finish agency onboarding.
6. Rehearse with synthetic contacts and preview mode. Assign employee permissions and check that each employee sees only the intended CRM sections and calls. Install/sign in to the desktop app or keep the web assistant open for staff assistance.
7. The real business owner completes `/client/launch`, recording test results, remaining checks, and a fallback contact. The application checks this acceptance before enabling a real managed client's live mode. The checklist is an attestation, not proof that a provider test passed or that legal obligations are satisfied.
8. Partner and client perform the supervised provider tests below. Enable only the tested connections and workflows. Keep a human responsible for calls and pending approvals.
9. In `/client/integrations`, the authorized business owner/manager can opt into future imported-lead automation and CRM lifecycle automation. Old records are not bulk-messaged. Review and approve the resulting proposed actions in `/client/approvals`.
10. Review the first business's activity and support requests daily during the supervised trial. Repeat onboarding only after a partner can complete the checklist without platform staff doing routine setup for them.

## What the ten audit actions now cover

| Audit action | Implemented in this change | Remaining evidence or owner task |
| --- | --- | --- |
| 1. Invitation identity | Verified Auth identity, immutable profile email, safe owner lookup | Exercise real email invitation delivery in staging |
| 2. Actor and tenant boundaries | Membership restrictions, employee payload filtering, tenant-bound secrets, impersonation checks | Repeat the role smoke test after deployment |
| 3. Atomic approved actions | Transactional approval outbox, single claims, immutable approved payload, uncertain outcome quarantine, owner reconciliation with transactional audit | Real send/booking and provider timeout checks |
| 4. Durable intake and sync | Encrypted inbound jobs, bounded retry/dead letters, checked cursor persistence, deduplication | Public signed webhooks and hosted scheduler recovery |
| 5. Phone and desktop safety | Caller privacy, session-specific bookings, staff call claims, transcript recovery, live-mode gates, voice limits | Real calls, simultaneous desktop sessions, signed macOS/Windows install and update |
| 6. Pilot integrations | RingCentral notification handling, Google Business resource paths, refreshed credential persistence, pinned public webhook destinations, truthful capability listings | Accounts, provider approvals and one real test per selected capability |
| 7. Provider ownership | Guided connection path and recorded client acknowledgment of account/usage responsibility | You, partner, client and vendors must establish actual accounts and permissions |
| 8. Operations and AI | Honest scheduler failure responses, retention, daily text-token reservations, voice usage receipts, evaluation runner, local restore evidence | Hosted alert delivery, live model evaluation, invoice-based cost measurement and production restore drill |
| 9. End-to-end proof | Synthetic production-build customer journey, actual database/concurrency tests and service image checks | Deployed journey and signed desktop installations on both OSes |
| 10. Training and obligations | Agency launch guide, this runbook, client launch acceptance and support ownership | Professional privacy/consent/contract review and agreement with pilot participants |

Actions 7, 9 and the external portions of 8 and 10 cannot honestly be called complete from repository changes alone.

## Platform setup before enabling purchases or live customer traffic

Use the existing migration-first release workflow and deployment guides. Apply migrations through `20260904190000_beta_release_marker` before deploying the corresponding application. Configure the application, jobs and voice gateway with matching release identifiers; keep the Codex connector worker isolated. Preserve the previous release for rollback and back up the database before migration.

Configure secrets on the host, not in source control. `.env.example` now documents the partner Stripe checkout settings, bounded job batch, text AI token ceiling and voice call limits. Platform Stripe billing and a business's Stripe integration use separate credentials and purposes.

For checkout, configure the exact one-time and recurring prices, Stripe webhook endpoint `/api/billing/stripe`, and billing portal. Keep `PARTNER_CHECKOUT_ENABLED=false` until a test-mode purchase, webhook replay, expired checkout, subscription cancellation and billing portal have been verified. Self-service enrollment provisions once; inactive subscriptions cannot add clients, and ten managed clients is enforced transactionally. Existing workspaces remain accessible after subscription delinquency so client operations are not abruptly interrupted; suspension/collections policy remains an owner decision.

Establish account ownership in writing: platform owns hosting and shared provider applications; the partner owns its configured Twilio parent account and associated billing; client phone subaccounts are isolated. Clients authorize their business CRM, email and calendar accounts. Verify actual vendors, scopes, approvals, sender permissions and number routing before advertising that path. Some providers require account or application approval; this repository does not prove those approvals exist.

## Required real-provider acceptance record

Record date, release, tester, account/provider, redacted request references, expected result, observed result and pass/fail. Use consenting test participants and test-mode billing; this guide does not authorize real charges or outreach.

- Verified invitation -> partner logo -> package -> client invitation -> client sign-in -> employee restriction check.
- Form, email or connected lead source -> one contact/lead -> proposed action -> client rejection causes no send; edited approval sends only the approved text once.
- Repeat a signed webhook and interrupt a worker; confirm one result, durable retry and no duplicated customer action.
- Real Twilio inbound AI conversation and outbound approved callback; interrupt speech, hang up, exercise unavailable/busy/error paths, and verify human escalation is described as a request rather than an immediate transfer.
- Two simultaneous real calls and two signed-in staff members: correct popup, assigned call, ordered transcripts, no other customer's details spoken, final summary after hangup.
- Actual calendar availability -> approved booking -> one calendar entry and correct confirmation; compete for the same slot and verify the second request fails safely.
- New appointment within 24 hours, quote explicitly marked sent and at least three days old, completed appointment -> appropriate pending reminder/follow-up/review approval. Native triggers apply to records created after opt-in; marking a quote sent records a status and does not itself email a quote.
- One supported external CRM: verify the exact contact/note/appointment capabilities being sold. Do not infer comprehensive bidirectional sync, deletion reconciliation or migration support from a successful credential connection.
- Stop a provider or worker: observe failure in platform health and receipt by the real support destination; restore operation and confirm safe recovery.
- Signed macOS and Windows installation, microphone/desktop behavior where applicable, sign-in, popup, update to a newer signed build, and rollback rehearsal. Container health and unsigned builds do not replace this test.

## Failure recovery and support ownership

**Client:** reviews proposed actions, checks delivery status and handles customer requests. A retry button appears only for retryable outcomes. An `uncertain` delivery may already have reached the provider: the business owner checks provider records and uses **Record result without resending** with evidence. This records completion or closes an undelivered attempt; it does not send a replacement, rebuild CRM projections or claim an automatic provider verification. If the provider cannot establish the outcome, leave it unresolved and ask the partner for help.

**Partner:** checks client setup, provider authorization, workflow activity and logs; reconnects revoked integrations through setup; helps the client interpret errors. Partners do not approve, retry or reconcile customer actions through troubleshooting/impersonation access. Escalate persistent failures, ambiguous external CRM writes and quarantined inbound events with the client ID, run/job ID and sanitized provider reference. Dead-letter replay and ambiguous connector writes require controlled investigation; do not instruct a nontechnical partner to edit database rows.

**Platform:** owns deployment, scheduler/voice availability, encrypted-secret custody, backups, provider application configuration, escalated recovery and releases. Configure an independent uptime/heartbeat alert destination and prove alert receipt. The jobs endpoint reports HTTP 503 for partial worker failure and does not refresh a successful heartbeat when its batch fails. Local restore checks do not prove hosted recovery.

## Retention, usage and current limits

`OPERATIONAL_RETENTION_DAYS` defaults to 90 and controls bounded operational/raw-interaction cleanup. Durable business CRM records, approval evidence and audit records have different retention needs and are not indiscriminately erased. Third-party recordings need a separate provider retention policy.

`AI_DAILY_TOKEN_LIMIT` defaults to 100,000 for shared text-model calls per client/partner scope. Reservations serialize concurrent calls; failures fall back conservatively. `VOICE_MAX_CALL_SECONDS` defaults to 900 and `VOICE_MAX_CALL_TOKENS` to 100,000 per call. These are token/duration controls, not a complete money budget; measure provider invoices, call minutes, email/SMS use and hosting cost during the pilot. A voice gateway process failure can lose transcription not yet delivered to the application.

The offline AI evaluator prepares three safety scenarios; live evaluation is explicit and needs a scoped test client. Do not describe those offline cases as a measured model accuracy score. Exported Make/Zapier/n8n packs still require setup; direct browser Realtime calling and live telephone transfer are not completed product paths. Reports and external CRM capabilities remain bounded by implemented data loaders and provider contracts.

## Local evidence from this implementation

- Full automated suite: 268 tests passed; TypeScript and ESLint passed.
- Real local PostgreSQL security matrices: role isolation, ownership, secret boundaries, approval races/outbox claims, AI budget races, retention, voice transcripts, calendar exclusion, billing fulfillment/capacity, native workflow queue and owner reconciliation.
- Production application build passed with isolated local Supabase and provider keys disabled. Browser checks covered partner signup/launch guide, client launch and automation controls, mobile layout, and an owner recovery action with exactly one audit receipt and no new send attempt.
- Synthetic customer journey passed across intake, approvals, voice simulation, CRM activity, support and guarded worker retry/escalation. This does not establish model/carrier performance.
- Native lifecycle integration verified queue -> workflow -> pending approval, duplicate suppression, no unauthorized send and opt-out cancellation.
- Web container build and standalone boot passed; service-image verification passed scheduler, connector worker and voice gateway health/authentication checks; release topology verification passed. The first web container attempt exhausted the local 4 GB Docker VM while both test stacks were running; it passed after stopping the disposable stack.
- Restore drill passed: 78 application tables, row counts, RLS policies and functions matched on a separate disposable target from the isolated synthetic stack.
- Production dependency audit reported zero vulnerabilities at the time of the check. This is dependency evidence, not a complete security certification.

No production deployment, real OAuth authorization, external message, real phone call, purchase, signed desktop publication or professional review was performed in this implementation session.

## Recommended launch sequence

1. Finish one staging deployment and the real-provider/desktop acceptance record above with one friendly agency and one consenting business. Keep that business supervised until all failures are understood.
2. Have the agency implement a second synthetic client using only the guide. Record every point where platform staff must intervene; simplify those steps before adding partners.
3. Review one week of actual usage costs, pending approvals, missed interactions, retries and support requests. Choose the included usage and commercial terms from observed costs.
4. Complete the professional contract/privacy/consent review and prove alert and restore procedures. Enable self-service paid enrollment only after the test-mode billing journey passes.
5. Expand one verified provider and workflow at a time. Publish a capability matrix distinguishing locally tested, vendor-verified and unavailable paths.
