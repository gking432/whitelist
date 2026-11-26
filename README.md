# Partner AI Platform

Build handoff: [parallel development brief](docs/45-parallel-build-brief.md), [current progress](docs/46-build-progress.md), and [copyable launch prompt](docs/10-codex-goal-prompt.md). Hosted account access is a scoped live-testing gate; continue independent product implementation while it is unresolved. Preserve the existing uncommitted code and the user's decision to remove local Docker storage.

Current execution order: [Complete product roadmap](docs/44-nightly-launch-roadmap.md). Hosting and Google setup are one foundation task. The full product includes connected business records, guided setup, the single pane, coordinated agents, manager controls, approved execution, workflow observation/improvement, analytics and web/iPhone/Android delivery. See [the connected-data handoff](docs/43-connected-data.md) for the first connection slice and its live setup blockers.

This repository contains the existing multi-tenant business application and
the shared execution infrastructure for custom AI implementation work.

The current priority is one client-facing product:
describe the business, activate useful agents and automations, connect existing
tools, and oversee results and approvals. Agents use shared customer records;
the detailed CRM is an optional interface. Development of the partner CRM and
platform-owner CRM and white-label commercialization is deferred. The company
has two offers: the packaged solo-business app and custom “Agents Built In”
implementations inside established businesses' existing software.

Start with the [shared customer team](docs/39-shared-customer-team.md)
and [complete product roadmap](docs/44-nightly-launch-roadmap.md).
The [business model and pricing discussion](docs/33-business-model-and-pricing.md)
is preserved for later. These documents change development priorities; the
existing account boundaries remain in place.

The existing app now connects the shared CRM, customer conversations,
department assignments, owner approvals, and checked execution. Use
`npm run prototype` for local services, then open `http://localhost:3210`
and select an authorized business workspace. Development fixtures are separate
from normal onboarding. The current handoff distinguishes implemented paths
from live-provider and production-readiness checks that remain outstanding.

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
ANTHROPIC_API_KEY=           # server-only: required for generated agent work;
                             # missing configuration blocks that assignment
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

Existing product surfaces, before the planned client-experience simplification:

- `/partner` — dashboard with health rollups and attention queue.
- `/partner/clients`, `/partner/clients/new` — client business management.
- `/partner/clients/[clientId]` — workspace tabs: Overview, Integrations,
  Workflows, Runs / Logs, Approvals, Reports, Settings, Audit.
- `/api/integrations/inbound/[connectionId]` — secured inbound webhook intake
  (per-connection credential, envelope validation, idempotency, rate limit).
- `/client`, `/client/approvals`, `/client/activity`, `/client/integrations` —
  optional partner-branded client portal.

Local seed accounts use `local-password-change-me` and `.example.test`
addresses. They are for a local Supabase instance only.

Verification for each goal:

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Start here:

1. Read [Start Here](docs/00-start-here.md) for current priorities and boundaries.
2. Read the [client product blueprint](docs/34-client-product-blueprint.md).
3. Read the [readiness assessment and build plan](docs/35-client-product-readiness-and-roadmap.md).
4. Consult the existing architecture and implementation documents for the area
   being changed. The original goal sequence is historical, not the current backlog.

## Docs

- `docs/00-start-here.md`: boundaries, product stance, and how to begin.
- `docs/33-business-model-and-pricing.md`: agency resale strategy, pricing hypotheses, and validation questions.
- `docs/34-client-product-blueprint.md`: current client experience, business-area catalog, shared records, and guided activation.
- `docs/35-client-product-readiness-and-roadmap.md`: implementation evidence, gaps, and proposed build sequence.
- `docs/01-product-requirements.md`: original requirements and first-pass success criteria.
- `docs/02-architecture.md`: route, tenancy, integration, workflow, audit, and runtime architecture.
- `docs/03-data-model.md`: proposed tables, enums, and RLS expectations.
- `docs/04-roles-permissions-tenancy.md`: user roles, permission matrix, and access rules.
- `docs/05-integrations-workflows-ai.md`: integration, workflow, approval, and AI contracts.
- `docs/06-ui-screens-flows.md`: required product screens and user flows.
- `docs/07-goal-build-sequence.md`: historical scaffold and partner-platform build sequence.
- `docs/08-acceptance-verification.md`: acceptance criteria and verification scenarios.
- `docs/09-decisions-and-open-questions.md`: locked decisions and remaining product questions.
- `docs/10-codex-goal-prompt.md`: current handoff guidance for an implementation task.

## Relationship To Earlier White-Label Spec

The client product blueprint supersedes conflicting earlier product priorities.
White-label resale remains a later option. Tenant isolation, permissions, reliable
execution, and audit history remain core requirements. Shared operational
records support agents even when the owner does not use a CRM interface.
The separate project at `/Users/gkn/new` remains untouched. Development fixtures
must remain clearly identified test data; production outcomes must come from
real records.
