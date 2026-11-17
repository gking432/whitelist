# Start Here

## Current direction

**November 16, 2026 execution priority:** use the [parallel development brief](45-parallel-build-brief.md) and [build progress](46-build-progress.md) to implement the full product. Live database/Google access blocks the affected verification, not all coding. Start with shared source-backed business context, enforced owner authority/manager controls and reviewed onboarding; then continue the workflow/observer/mobile backlog. Delegate bounded coding work when available, integrate and test it, and preserve the current uncommitted implementation. The user removed the local Docker/Colima database to recover disk space; do not recreate it as the default next step.

**November 5, 2026 — corrected full-product scope:** follow the [complete product roadmap](44-nightly-launch-roadmap.md). Hosting and Google setup are one foundation work package. The full plan includes connected applications, shared business records/context, guided onboarding, the single pane, coordinated agents, approvals and verified actions, manager chat, customer/sales/scheduling/marketing/operations work, workflow observation, outcome analytics, business playbooks, web/iPhone/Android delivery and production launch. Agents and workflow improvement are core product work, not an unspecified follow-up after releasing a read-only app. Reuse the existing project and tested execution paths. See [the connected-data handoff](43-connected-data.md) for that foundation's implementation and access blockers. This roadmap supersedes earlier build orders.

**October 7, 2026 background:** one company with two offers: a packaged solo-business app, and custom "Agents Built In" implementations inside established businesses' existing software. The job search continues alongside both. The [revised build plan](38-agent-team-build-plan.md#current-direction--october-7-2026) records the earlier sequence. New partner/platform-owner CRMs and white-label commercialization remain deferred; purchasing/sourcing are optional specialist modules. Existing application code, tenant boundaries, integrations, and approvals remain the foundation.

The October 2–3 discussion established the simple owner experience, shared customer records, and Symphony-inspired coordinated work. Those patterns remain useful, but the broad department/industry catalog is a future opportunity list, not a requirement to finish every department before a pilot. The custom offer starts with workflow discovery and employee efficiency, not prepackaged sales and purchasing agents.

Read these documents first:

- [Shared customer team](39-shared-customer-team.md): October 8 implementation, actual department/channel support, activation steps, verification, and live-launch gaps.
- [Agent team build plan](38-agent-team-build-plan.md): the current two-offer direction, existing implementation evidence, revised build order, and pilot acceptance checks.
- [Business capabilities and business types](37-business-capabilities-and-business-types.md): the business problems to solve, current AI/automation implementation, proposed agent responsibilities, limits, and potential client industries.
- [Business workspace prototype](36-business-workspace-prototype.md): what was built, how to open it, verification, and remaining hosting/provider limitations.

1. [Client product blueprint](34-client-product-blueprint.md): the earlier broad product vision, reusable setup pattern, and catalog of business capabilities.
2. [Client product readiness and build plan](35-client-product-readiness-and-roadmap.md): the historical assessment of foundations and gaps; document 44 sets the current sequence.
3. [White label business model and pricing](33-business-model-and-pricing.md): the preserved commercial discussion, including assumptions that remain unvalidated.

These documents supersede conflicting partner-first priorities below and in the original specifications and goal sequence. Existing tenancy, permissions, branding, and support infrastructure remain relevant. The client entry and navigation now prioritize the business workspace; the optional detailed CRM and administrative routes remain available.

For historical beta verification and deployment requirements, consult [the supervised beta launch guide](28-beta-launch-guide.md) and [hosted beta notes](32-vercel-beta-workspaces.md). Product specifications and catalog labels are not proof of real-provider readiness.

## Current implementation handoff

Use [the parallel development brief](45-parallel-build-brief.md) for execution, [build progress](46-build-progress.md) for the current task, [the product roadmap](44-nightly-launch-roadmap.md) for outcomes and [the handoff guidance](10-codex-goal-prompt.md) for the launch prompt. Documents 34–35 preserve the earlier broad vision, phased recommendations, and readiness evidence. Consult existing architecture, schema, and integration documents for the affected area, and read the applicable repository and framework instructions before changing code.

## Historical project brief

The remainder records the original project brief for context. Its partner-first build strategy and home-service-only framing are superseded by the current direction above. The absolute boundaries and tenant/branding protections continue to apply.

## Purpose

Build a new production-grade partner/agency platform for selling, managing, and monitoring AI automations and business-system integrations for home service businesses.

This project exists because the current Northstar app must remain untouched as a portfolio centerpiece. Northstar can inspire product thinking, but it must not become this platform and must not be modified as part of this build.

## Absolute Boundaries

- Do not edit `/Users/gkn/new`.
- Do not import the current Northstar app as a dependency.
- Do not migrate the Northstar database.
- Do not reuse Northstar routes, auth, schema, or environment variables directly.
- Do not build demo-only product surfaces.
- Do not use fake data as part of the product experience.
- Do not make homeowners aware of the partner or platform brand.

Development seed data is allowed for local testing, but the product itself must be designed as a real production app from the first pass.

## Primary Buyer

The buyer is a partner/agency.

Use `Partner` in the UI unless explicitly changed later. Avoid `whitelister` in the product interface; it is an internal planning term.

Partners sell AI automation, integration management, and operational visibility services to home service businesses.

## Product Center Of Gravity

This is not primarily a CRM.

The first product should be a Partner Integration Operations Platform:

- client business management.
- integration setup and health.
- automation/workflow enablement.
- workflow runs and event logs.
- approval queues.
- issue investigation.
- usage and ROI reporting.
- permissioned client visibility.
- partner-branded client-facing software where needed.

A built-in CRM can exist later as one operating mode, but many client businesses will already have a CRM. The first build should make sense even when the client keeps their existing CRM.

## The Four Layers

1. Platform owner
   - The software owner.
   - Manages partners, plans, usage, support, global templates, infrastructure health, audit logs, and risk controls.

2. Partner
   - The agency/customer buying this platform.
   - Manages multiple client businesses, integrations, automations, approvals, logs, health, and reporting.

3. Client business
   - The partner's customer, such as a roofing, HVAC, plumbing, restoration, remodeling, pest control, electrical, or landscaping business.
   - May or may not log into the app.
   - If they log in, they should see integration health, approvals, reports, and issue logs relevant to their business.

4. Homeowner/customer
   - The client business's customer.
   - Interacts through forms, calls, SMS, email, chat, scheduling links, and reminders.
   - Should see only the client business brand.

## Branding Rules

- Platform brand is visible to platform owner users.
- Partner brand should be visible to partner users.
- Client-facing app surfaces should generally carry the partner brand in header/footer/reports/support areas, because the partner is the reseller.
- Homeowner-facing surfaces should carry only the client business brand.
- Homeowners should never see partner/platform names, workflow logs, AI controls, or integration details.

## First Build Strategy

Build the smallest production-shaped vertical slice:

1. Authenticated partner user.
2. Partner organization.
3. Client businesses under that partner.
4. Client detail workspace.
5. Integration connections and health.
6. Workflow templates and client workflow instances.
7. Workflow run/event logs.
8. Approval queue.
9. Audit logs.
10. Basic client portal access, if enabled.

Do not start with a full CRM. Start with the partner's need to manage client automations and integrations.

## Recommended Stack

Use a modern production-ready stack unless the user chooses otherwise:

- Next.js App Router.
- TypeScript.
- Supabase Postgres/Auth/RLS.
- Server actions or route handlers for trusted mutations.
- Tailwind and shadcn-style components.
- Background jobs/queue abstraction planned, even if initial runs are synchronous.

If the chosen stack differs, update these docs before building.

## Original initial command retained for history

The original handoff asked a new task to execute the scaffold sequence in document 07. That sequence has been superseded; use document 10 and the current client-product build plan instead.

## Definition Of A Good First Pass

A good first pass does not need every integration or AI workflow fully built.

It does need:

- real auth-ready architecture.
- clear tenant boundaries.
- partner/client data model.
- role and permission model.
- production-looking partner dashboard.
- client business detail workspace.
- integration hub.
- workflow instance model.
- event/run logs.
- approval item model.
- audit logging.
- no accidental dependence on Northstar.

- [Connected apps beta: setup, verification and activation](30-connected-apps-beta.md)
- [Owner assistant setup and shared app connections](40-agent-connection-activation.md)

The current Google read-only connection implementation, live-test blockers, and deployment steps are in [Connected data](43-connected-data.md).
