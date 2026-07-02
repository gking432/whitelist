# Start Here

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

## Suggested Initial Command For A New Codex Thread

```text
Read every file in /Users/gkn/partner-platform/docs before writing code. Then create the production app described there, following docs/07-goal-build-sequence.md one goal at a time. Do not modify /Users/gkn/new. Do not create demo-only behavior. Ask only for decisions that block architecture or product correctness.
```

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

