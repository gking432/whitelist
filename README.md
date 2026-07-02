# Partner AI Platform

This folder contains the planning docs and production scaffold for a new partner
operations platform.

It is intentionally separate from `/Users/gkn/new`, which contains the existing Northstar portfolio demo. Do not modify, migrate, import, or depend on the Northstar app when building this product.

## Local Development

```bash
npm install
npm run dev
```

The app runs without Supabase credentials, but sign-in remains disabled until
local environment values are configured.

Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Goal 1 adds Supabase migrations and local development seed data:

- `supabase/migrations/20260621180500_goal_1_tenant_auth_foundation.sql`
- `supabase/seed.sql`

Local seed accounts use `local-password-change-me` and `.example.test`
addresses. They are for a local Supabase instance only.

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
