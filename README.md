# Partner AI Platform

This folder contains the multi-tenant, white-label Northstar product. It
combines the partner operations platform with the CRM and AI operating suite
originally prototyped in `/Users/gkn/new`.

Northstar is the product partners sell under their own branding. A partner can
run it for their own agency, offer the built-in CRM to clients that need one,
or install the AI and automation layer alongside a client's existing CRM.

## Local Development

```bash
npm install
npm run dev
```

The app runs without Supabase credentials, but sign-in remains disabled until
local environment values are configured.

Copy `.env.example` to `.env.local` and set:

```bash
APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server-only: webhook intake + run engine
SECRETS_ENCRYPTION_KEY=      # server-only: openssl rand -base64 32
ANTHROPIC_API_KEY=           # server-only: AI workflow output (optional —
                             # workflows fall back to labeled rule-based output)
AI_MODEL=                    # optional model override (default claude-opus-4-8)
```

Supabase migrations and local development seed data:

- `supabase/migrations/20260621180500_goal_1_tenant_auth_foundation.sql`
- `supabase/migrations/20260702100000_goal_4_integration_foundation.sql`
- `supabase/migrations/20260702100100_goal_6_workflow_foundation.sql`
- `supabase/migrations/20260702100200_goal_8_approvals.sql`
- `supabase/migrations/20260702100250_goal_9_client_portal_access.sql`
- `supabase/migrations/20260702100300_goal_10_reports_health.sql`
- `supabase/seed.sql`

Implemented product surfaces:

- `/partner` — dashboard with health rollups and attention queue.
- `/partner/clients`, `/partner/clients/new` — client business management.
- `/partner/clients/[clientId]` — workspace tabs: Overview, Integrations,
  Workflows, Runs / Logs, Approvals, Reports, Settings, Audit.
- `/api/integrations/inbound/[connectionId]` — secured inbound webhook intake
  (per-connection credential, envelope validation, idempotency, rate limit).
- `/client`, `/client/approvals`, `/client/activity`, `/client/integrations` —
  optional partner-branded client portal.

Local seed accounts use `local-password-change-me` and `.northstar.test`
addresses (`platform@`, `partner@`, `client@`). They are for a local Supabase
instance only. The seed is intentionally minimal — no packages, integrations,
workflows, or CRM data. See `docs/22-demo-walkthrough.md` to build a demo
tenant by walking the real onboarding.

Verification for each goal:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Start here:

1. Read `docs/00-start-here.md`.
2. Read `docs/01-product-requirements.md`.
3. Read `docs/02-architecture.md`.
4. Follow `docs/07-goal-build-sequence.md` one goal at a time.

The desired first product is a production-grade partner/agency platform for managing client business integrations, AI workflow operations, approvals, logs, and health. It is not a demo app and it is not primarily a CRM clone.

## Docs

- `docs/00-start-here.md`: boundaries, product stance, and how to begin.
- `docs/01-product-requirements.md`: product requirements and first-pass success criteria.
- `docs/02-architecture.md`: route, tenancy, integration, workflow, audit, and runtime architecture.
- `docs/03-data-model.md`: proposed tables, enums, and RLS expectations.
- `docs/04-roles-permissions-tenancy.md`: user roles, permission matrix, and access rules.
- `docs/05-integrations-workflows-ai.md`: integration, workflow, approval, and AI contracts.
- `docs/06-ui-screens-flows.md`: required product screens and user flows.
- `docs/07-goal-build-sequence.md`: step-by-step build plan for `/goal` execution.
- `docs/08-acceptance-verification.md`: acceptance criteria and verification scenarios.
- `docs/09-decisions-and-open-questions.md`: locked decisions and remaining product questions.
- `docs/10-codex-goal-prompt.md`: copy/paste prompt for a build thread.

## Relationship To Earlier White-Label Spec

These docs incorporate the useful parts of the earlier white-label AI integration platform planning, but they supersede any earlier assumptions that conflict with the current direction:

- the app is production-first, not demo-first.
- Northstar remains untouched.
- demo mode is out of scope.
- the buyer is the partner/agency.
- CRM is optional and not the first center of gravity.
- integration operations, workflow logs, approvals, and tenant safety come first.
