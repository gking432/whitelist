# Decisions And Open Questions

## Current direction recorded October 7 2026

- One company, two offers: the packaged solo-business app and custom "Agents Built In" engagements. Continue the AI implementation job search alongside them.
- The app handles reusable customer/admin work with shared records and a simple phone experience. It includes background automation, not just chat.
- Custom implementations follow interviews, data research, and workflow redesign inside the client's existing systems. They are not generic sales/purchasing agents or simply a higher subscription tier of the app.
- Preserve and reuse the existing application. White-label commercialization and partner/platform-owner CRMs are deferred. Purchasing/sourcing are later specialist capabilities, primarily relevant to resellers, rather than the default product direction.
- The [revised build plan](38-agent-team-build-plan.md) records current implementation evidence and recommended next steps. Exact first pilot, custom workflow, provider connections, direct-client pricing, and company name remain unselected.

## Earlier clarification from October 3 2026

- The user identified Symphony as the reference product; [Symphony by Wix](https://www.wix.com/symphony) matches the described business setup, coordinated agents, connected tools, and owner approvals.
- Build that class of business-owner product now in the existing partner-platform application. Add the remaining white-label and agency commercial layer afterward.
- A shared business coordinator, scoped business context, proactive work, real connected actions, and simple phone decisions are active product requirements.
- Marketing, sourcing, purchasing, operations, and the other business outcomes in [the capability catalog](37-business-capabilities-and-business-types.md) remain in scope. Website chat is one capability, not the whole assignment.
- Keep existing useful implementation and foundational permissions/tenant isolation. Do not restart the app or make a fictional business the normal entry point.

The [updated blueprint](34-client-product-blueprint.md#symphony-reference-and-current-build-priority) and [implementation handoff](10-codex-goal-prompt.md) carry this priority. It supersedes the earlier narrow next-task recommendation in the pre-build roadmap.

## Earlier decisions from October 2 2026

- Focus development on the single client-facing product that agencies sell to businesses.
- Defer the partner CRM and platform-owner CRM.
- Keep the agency as the commercial buyer and preserve white-label resale as the intended business model.
- Maintain shared operational customer records for agents regardless of whether the owner opens a CRM interface.
- Recommend useful agents and ordinary automations from the business description, with guided connections and rules.
- Support phone-friendly human approvals and optional detailed records.
- Expand across business areas and operating models; voice is an optional capability.

See the [client product blueprint](34-client-product-blueprint.md) for details, [readiness and build plan](35-client-product-readiness-and-roadmap.md) for implementation scope, and [commercial record](33-business-model-and-pricing.md) for pricing hypotheses. These current decisions supersede conflicting original priorities below. Screen proposals and roadmap details remain recommendations unless explicitly identified as user decisions.

## Historical decisions and questions

The remaining sections preserve the original project discussion. They are not the current prioritized backlog; some original open questions have since gained implementations or changed direction.

## Original decisions

### Northstar Must Remain Untouched

The current project at `/Users/gkn/new` is the Northstar portfolio demo.

Do not modify it for this build.

### Build A Separate Production App

The partner platform should be a separate app/project so production tenancy, auth, permissions, and integration architecture do not risk breaking Northstar.

### Use "Partner" In The Product

Use `Partner` for the buyer in UI copy.

Avoid `whitelister` in the app. It can remain an internal planning term.

### Buyers Are Partners/Agencies

The initial buyer is a partner/agency, not direct home service businesses.

Direct client-business sales are out of scope unless this changes later.

### Demo Is Out Of Scope

Do not build demo mode, guided tours, fake-data sales flows, or simulated-only product surfaces for this app.

Local development seed data is allowed for testing, but the product should behave like a real app.

### CRM Is Optional, Not The Starting Center

Many home service businesses already have a CRM.

The first version should focus on integration operations, automation management, logs, approvals, and health. A built-in CRM may become a later operating mode.

### Partner Can Edit Client Data Only With Permission

Default:

- partner can inspect, configure, troubleshoot, and support.
- partner cannot edit client operational data unless permission is granted.

Every partner edit of client data must be audited.

### Homeowners Never See Partner Or Platform Branding

Homeowners see only the client business brand.

Partner/platform branding can appear in client-facing app/report/support surfaces, but not homeowner communications unless explicitly reconsidered.

## Open Questions

### Product Naming

What should the app/product be called?

Working names:

- Partner AI Platform.
- Partner Operations Hub.
- AI Integration Hub.
- ServiceOps Partner Platform.

Decision needed before final branding, not before first scaffold.

### First Real Integration Priority

If generic webhooks are first, what comes next?

Options to research:

- HubSpot.
- GoHighLevel.
- ServiceTitan.
- Jobber.
- Housecall Pro.
- JobNimbus.
- Service Fusion.
- FieldPulse.
- Zapier app.
- n8n pack.
- Make app.

Recommendation:

Start with generic inbound/outbound webhooks, then research partner/client market before choosing the first native CRM adapter.

### Client Portal Day-One Scope

Should clients log in on day one?

Options:

1. partner-only v1.
2. minimal client portal for approvals and health.
3. fuller client operations portal.

Recommendation:

Build the data/permission model for client users early, but keep client portal minimal until partner workflows are proven.

### First Must-Work Workflow

Which workflow should be implemented first?

Options:

- New lead intake.
- Missed-call rescue.
- Appointment reminder.
- Estimate follow-up.
- Review request.
- Sync failure alert.

Recommendation:

New lead intake plus sync failure alert. Together they prove inbound events, workflow runs, logs, health, and issue visibility.

### AI In First Version

Should AI outputs be part of the first production slice?

Options:

1. integrations/logs/permissions first, AI later.
2. one AI classification/draft workflow in first pass.
3. multiple AI workflow templates from the beginning.

Recommendation:

Model AI from the beginning, but keep first AI behavior narrow and approval-gated.

### Billing Scope

Should first pass include billing?

Options:

1. plan assignment only.
2. usage tracking only.
3. Stripe/payment integration.

Recommendation:

Plan assignment and usage tracking first. Payment automation later.

### Client Branding Vs Partner Branding

For client portal/report surfaces, should branding prioritize:

1. partner brand first.
2. client brand first.
3. co-branded: client workspace with partner-powered footer/support.

Current instinct:

Partner brand should be visible to client users because the partner is the seller/provider. Client business brand should appear where the client is the subject of work. Homeowner-facing surfaces show only client brand.

### Primary CRM Timing

When should primary CRM mode be built?

Options:

1. out of scope for v1.
2. light CRM records only.
3. full CRM operating mode.

Recommendation:

Out of scope for first production slice. Do not let CRM scope delay partner integration operations.

### Support Ownership

Who owns failed automations?

Options:

- platform owner.
- partner.
- client admin.
- depends on issue type.

Recommendation:

Partner owns first-line support for client-facing issues. Platform owner owns infrastructure/platform failures. The app should show ownership/next action on each issue.

### Provider Accounts

Should SMS/email/voice use:

1. platform-owned provider accounts.
2. partner-owned provider accounts.
3. client-owned provider accounts.
4. all of the above by tier.

Recommendation:

Defer real communications until after integration/logging foundation. When implemented, support partner-owned or client-owned accounts where possible to reduce platform liability.

## Questions To Ask Before Coding Provider-Specific Integrations

- Which tools do target partners already use?
- Which CRMs do their clients already use?
- Do partners want to bring their own automation tools, or have this app host the logic?
- What systems must be read-only versus write-back?
- What compliance/consent rules apply to SMS/voice/email?
- Who pays for provider usage?
- Who handles deliverability and number/email reputation?

## Questions To Ask Before Building Full CRM Mode

- What minimum CRM entities are required?
- Does "lead" become "job" after sale?
- Are estimates/proposals/invoices required?
- Does scheduling need crew/production calendars?
- Does field service dispatch matter?
- Does the app need two-way SMS/email inbox?
- Does the app need pipeline/kanban views?
- Can this be handled by external CRM integrations instead?

## Current Best First Pass

Build:

- separate app.
- production auth/tenancy.
- partner dashboard.
- client business workspaces.
- integration hub.
- generic inbound webhook.
- workflow templates/instances.
- workflow runs/logs.
- approval queue.
- audit logs.
- minimal client portal foundation.

Do not build:

- demo mode.
- full CRM.
- native CRM adapter before research.
- real SMS/email/voice sends.
- billing automation.
- Northstar modifications.
