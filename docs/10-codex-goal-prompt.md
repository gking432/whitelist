# Codex Goal Prompt

Use this prompt when starting the build in this project.

```text
You are building the Partner AI Platform in /Users/gkn/partner-platform.

Before writing code, read every file in /Users/gkn/partner-platform/docs:

- docs/00-start-here.md
- docs/01-product-requirements.md
- docs/02-architecture.md
- docs/03-data-model.md
- docs/04-roles-permissions-tenancy.md
- docs/05-integrations-workflows-ai.md
- docs/06-ui-screens-flows.md
- docs/07-goal-build-sequence.md
- docs/08-acceptance-verification.md
- docs/09-decisions-and-open-questions.md

Then execute the goals in docs/07-goal-build-sequence.md one at a time.

Hard boundaries:

- Do not modify /Users/gkn/new.
- Do not import or depend on the Northstar demo.
- Do not build demo-only behavior.
- Do not use fake data as product behavior.
- Use "Partner" in the product UI.
- The buyer is the partner/agency.
- The first product is a partner integration operations platform, not a full CRM.
- Clients may have optional portal access.
- Homeowners never see partner or platform branding.
- Tenant isolation, permissions, audit logs, and safe integration handling are core requirements, not later polish.

Start with Goal 0 only. After Goal 0 is complete, report what was created, what verification passed, and what decisions remain before Goal 1.
```

## Follow-Up Goal Prompt Pattern

For each later goal:

```text
Continue in /Users/gkn/partner-platform. Read docs/07-goal-build-sequence.md and complete Goal [N] only. Keep the work scoped to that goal. Do not modify /Users/gkn/new. Run the verification listed in docs/08-acceptance-verification.md. Report completed files, behavior, test results, and any blockers.
```

