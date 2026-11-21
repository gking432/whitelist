# Production implementation plan

This document is the execution order for the complete white-label platform.
Each step must keep the existing product buildable and must pass its listed
verification before the next step is considered complete.

## Definition of done

A production-ready V1 lets:

1. A platform owner create and support a partner without exposing the
   platform brand to that partner's clients.
2. A partner finish branded onboarding, connect the partner-owned Twilio
   parent account, create a client, sell a package, and invite the client.
3. A client either use the built-in operating suite or connect an existing
   business stack through a guided connection link.
4. A real customer call, text, email, chat, or form submission create or find
   the correct customer record and run the installed workflows.
5. AI answer a call or assist a staff member, preserve the transcript and
   notes, recommend real available appointment times, and write the approved
   outcome to the selected system.
6. Owners and partners see health, logs, retries, and support context without
   partners controlling client-to-customer interactions.
7. Unsupported applications enter a visible integration-request workflow and
   can be fulfilled as reusable, reviewed connectors.

## Step 1: Stabilize the current product

- Reconcile production documentation with the shipped phone, desktop,
  automation-pack, connection-link, and partner-Twilio work.
- Keep demo-only tools out of normal production navigation.
- Confirm every migration, environment variable, and deployment service.
- Preserve a passing lint, typecheck, test, and production-build baseline.

Verification: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

## Step 2: Connector platform

- Define canonical customer, lead, job, appointment, note, message, invoice,
  payment, campaign, and review records.
- Add reusable connector manifests, capability declarations, credential
  strategies, field mappings, cursors, webhook registrations, sync jobs,
  retries, rate-limit handling, health checks, and connection tests.
- Keep credentials encrypted and server-only; audit every connection and
  external mutation.
- Support read, write, webhook, polling, and outbound-webhook connectors
  without provider-specific logic in the UI.

Verification: schema/RLS tests, adapter contract tests, webhook idempotency,
retry tests, secret-redaction tests, and a reference connector end to end.

## Step 3: Integration request center

- Let a partner search the supported catalog and request a missing application
  from the client setup flow.
- Capture the application, requested data flow, client context, urgency, and
  safe non-secret clarification messages.
- Give the platform owner a queue with assignment, status, conversation,
  internal notes, staging evidence, release version, and partner notification.
- Use the states requested, researching, needs-information, building, testing,
  ready, released, blocked, and declined.

Verification: tenancy/permission tests, request lifecycle tests, notification
tests, and owner/partner visual checks.

## Step 4: Guarded Codex fulfillment

- Convert an approved request into a sanitized connector specification and a
  development task; never place customer secrets in the prompt or repository.
- Let Codex research the official API, implement on a branch, run the connector
  contract suite, and attach results to the request.
- Require human review before staging and a second approval before production.
- Preserve feature flags, versioning, rollback, and an audit trail. No ticket
  can deploy code directly to production.

Verification: mocked task creation, prompt-injection tests, approval-gate
tests, failed-build handling, staging promotion, and rollback tests.

## Step 5: Built-in operating suite

- Complete the no-external-CRM path for contacts, leads, pipeline, inbox,
  calls, messages, appointments, tasks, quotes, reporting, permissions, and
  automation health.
- Make native records satisfy package requirements without asking the client
  to create outside CRM accounts.
- Keep phone transport on the partner-owned Twilio infrastructure and email
  delivery on the configured platform/partner provider.

Verification: empty-state checks, role matrix, create/update flows, complete
native customer journey, and desktop assistant write-back.

## Step 6: Productivity connectors

- Google Workspace: Calendar, Gmail, and contacts.
- Microsoft 365: Outlook calendar, mail, and contacts through Microsoft Graph.
- Support OAuth refresh, revocation, incremental sync, webhook renewal, native
  availability, booking, drafts, and approved sends.

Implemented locally: Google Workspace change tokens, Gmail history checkpoints,
Microsoft Graph delta links, scheduled webhook renewal, and refresh/API
authorization failure handling are wired into the durable connector runner.
Live-account validation remains part of the provider pilot.

Verification: provider contract tests plus live sandbox accounts when
credentials are available.

## Step 7: Field-service and CRM connectors

- Jobber, Housecall Pro, ServiceTitan, and Workiz first.
- HubSpot and GoHighLevel remain supported reference connectors.
- Normalize customer lookup, create/update, notes, jobs, appointments,
  estimates, and status changes according to each provider's capabilities.
- Queue FieldEdge, FieldPulse, Service Fusion, and ServiceM8 behind the same
  manifest and request system.

Verification: fixtures for every capability, duplicate-customer tests,
write-back tests, rate limits, webhook replay, and live vendor sandbox checks.

## Step 8: Finance and call attribution connectors

- QuickBooks Online for customers, estimates/invoices, payments, and status.
- Stripe and Square for payment events and links, not bookkeeping replacement.
- CallRail for caller identity, attribution, recordings/transcripts when
  permitted, forms, and text events.

Verification: signed webhook tests, reconciliation/idempotency tests, and live
sandbox checks.

## Step 9: Existing phone-system interoperability

- Keep Twilio as the native phone and AI automation layer.
- Add RingCentral, Dialpad, and OpenPhone capability-aware connectors for
  customers that retain those systems.
- Support forwarding/porting instructions, caller lookup, event ingestion,
  notes, and push-to-provider actions where the provider permits them.
- Never imply live audio assistance when a provider exposes only post-call
  events or recordings.

Verification: provider capability tests, real inbound calls, caller matching,
staff-assist overlay events, AI-answering calls, and failover behavior.

## Step 10: Lead, marketing, and reputation connectors

- Meta Lead Ads and Google lead sources first; marketing reporting remains a
  concise attribution dashboard rather than a campaign command center.
- Add Google Business Profile, Podium, and Birdeye review events and replies
  where approved.
- Add marketplace APIs such as Angi, Thumbtack, and Yelp only when access is
  granted; use universal webhook and lead-email intake meanwhile.
- Attribute source, campaign, cost when available, appointment, won work,
  revenue, and review outcomes without fabricating missing metrics.

Verification: webhook signature/idempotency, email parsing fixtures,
attribution tests, permission tests, and live sandbox checks where available.

## Step 11: One-click package installation

- A package declares capabilities rather than vendor names.
- Installation creates native workflows, identifies the minimum missing
  connections, sends the client a scoped connection link, verifies each
  provider, runs automated checks, and produces a launch checklist.
- Partners can configure and troubleshoot but cannot approve or operate the
  client's customer interactions.

Verification: package matrix tests, fresh-partner/fresh-client walkthrough,
connection-link security, rollback, and launch-gate tests.

## Step 12: Production operations and desktop distribution

- Deploy the app, hosted database, always-on voice stream, and background
  workers from reproducible configuration.
- Add monitoring, alerting, backups/restore testing, retention controls,
  abuse protection, support escalation, and operational runbooks.
- Require the isolated Codex connector worker to publish an exact-release,
  short-lived heartbeat; the public web process may queue approved work but
  never execute it.
- Sign and publish macOS/Windows desktop installers with secure configuration,
  automatic updates, and partner branding supplied by the hosted workspace.

Verification: clean production deployment, restore drill, worker retry drill,
security review, signed installer checks, and update/rollback check. The
credential-independent connector-worker failure/backoff/retry/stale-lease
drill runs in the release journey; signed update/rollback acceptance remains a
real-machine release task. Production deployment updates the trusted worker's
clean persistent checkout to the exact approved commit before hosted release
verification can succeed.

## Step 13: Full-system release verification

- Platform owner: provision and support a partner through audited read-only
  impersonation.
- Partner: onboard, brand, connect Twilio, create a package/client, request an
  integration, and troubleshoot logs.
- Client: use native mode and external-system mode with assigned permissions.
- Customer: call, text, email, chat, submit a form, and book an appointment.
- Staff: receive the desktop assistant, use recommendations, and push approved
  outcomes to the selected system.

Verification: automated suite, production build, browser visual checks,
desktop package checks, and a real-account pilot evidence report.

## External dependencies

Implementation can be completed without storing real credentials in source,
but live verification requires vendor test accounts, API applications, OAuth
credentials, and any required marketplace approvals. A connector is labeled
`contract_verified` until that live verification succeeds; only then may it be
labeled `live_verified`.
