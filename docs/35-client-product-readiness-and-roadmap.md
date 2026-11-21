# Client product readiness and build plan

**Current product task order — November 5, 2026:** use the [complete product roadmap](44-nightly-launch-roadmap.md). Hosting and Google are one foundation package. Agents, manager controls, business workflows, observation/improvement and mobile delivery are core work packages in that plan. The sequence below is historical wherever it conflicts with document 44.

**Build-priority update, October 3.** The user identified Symphony by Wix as the reference and directed us to build the full business-owner product before the remaining white-label layer. Use the [current blueprint priority](34-client-product-blueprint.md#symphony-reference-and-current-build-priority) and [implementation handoff](10-codex-goal-prompt.md). The website-chat-first recommendation below is retained as historical planning, not the complete active assignment.

**Pre-build assessment.** The October 2–3 implementation is documented in [Business workspace prototype](36-business-workspace-prototype.md). That handoff supersedes the current-state descriptions below for the client workspace, recommendations, business records, and internal recipes. The live-provider and production gaps still require verification.

Assessment recorded October 2, 2026, from repository inspection and verification during the accompanying discussion. The product has substantial foundations but does not yet deliver the [client experience now requested](34-client-product-blueprint.md). It is best described as a supervised beta foundation with several implemented workflows, rather than a self-service system that can configure and operate any business.

This is not a percentage-complete estimate. Existing code, catalog entries, passing local tests, and live provider readiness are different kinds of evidence.

## What the client product looks like today

Client access already supports a lightweight action center and an optional detailed CRM. The action center shows active automations, pending approvals, connected systems, recent runs, and delivery issues. It assumes configured workflows exist; its empty state tells the business that its partner sets them up.

The larger CRM exposes overview, pipeline, contacts, tasks, inbox, schedule, calls, quotes, marketing, automations, reports, CRM sync, and settings. A separate staff assistant console shows interaction context, drafts, booking proposals, and permitted actions. This is useful groundwork, but the complete business-driven recommendation, setup, and daily operating experience still needs to be built.

Source: [client entry](../app/client/page.tsx), [action center](../components/client/action-center.tsx), [CRM views](../lib/crm/views.ts), [staff assistant](../app/client/assistant/page.tsx), [assistant context](../lib/assistant/context.ts).

## Implemented foundations and gaps

| Capability | Evidence in the repository | Gap relative to the proposed product |
| --- | --- | --- |
| Lightweight client app | Action center, approvals, activity, integrations, notifications, support | A coherent mobile-first daily flow centered on business outcomes and decisions |
| Optional CRM | Internal contacts, leads, tasks, timeline, appointments, detailed views | A consistent operational customer record independent of CRM visibility and operating mode |
| Website chat | Approved business knowledge, session transcript, contact extraction, completed-chat intake event | CRM context during conversation, verified returning-customer identity, channel continuity, transactional tools |
| Business knowledge | Structured services, hours, areas, FAQs, booking rules, escalation information | Guided collection across industries; reviewed document/site imports, provenance, freshness, conflict handling |
| Existing workflows | Seven handlers: lead intake, missed-call rescue, estimate follow-up, appointment reminder, review request, intake routing, sync failure alert | Complete activation and real-provider proof for the supported jobs; more business domains |
| Capability catalog | Seventeen capability keys and fourteen automation-pack definitions | Business-context recommendations and dependencies linked to working, tested operations |
| Package presets | Basic Automation, AI Assist, Full AI Operations | Setup driven by business needs and installed systems instead of a feature bundle alone |
| Messaging | SMS/email delivery paths, inbound events, website chat, interaction records | Shared conversation lifecycle, centralized customer messaging preferences, robust cross-channel identity and takeover |
| Social channels | Meta lead/advertising integrations | Instagram DMs, Messenger, and WhatsApp conversational adapters were not found in the inspected implementation |
| Scheduling | Availability/booking foundations and approval proposals | A complete chat-to-request-to-approval-to-confirmation journey, then staff/resource/group/rescheduling rules |
| Approvals and execution | Permission checks, immutable approval payloads, an action outbox, retries, reconciliation mechanisms | Consistent use across all intake paths, expiry, phone notification experience, comprehensive policy-driven autonomy |
| Owner notifications | In-app records and email/SMS preferences and delivery | Push notifications and an installable/mobile app journey were not found in the inspected code |
| Voice | Phone answering and staff-assistance implementation with separate runtime | Live provider activation and operational proof; optional placement in the product |
| Integrations | Native connectors plus embedded connected-app setup and operation mappings | Operation-specific guided recipes; credentials, partner access, and provider testing where required |
| Marketing | Marketing/reporting surfaces, advertising connectors, draft and approval foundations | A complete opportunity-to-campaign-to-publication-to-results workflow |
| Sourcing and purchasing | Separate golf-shop procurement research and proposals are a reference | Shared-platform supplier, opportunity, requisition, ordering, and receiving models and workflows |
| Operations | Tasks, workflow runs, notifications, and exception reporting | Domain-specific jobs/orders, dependencies, materials, staff handoffs, and completion evidence |
| Outcomes and usage | Reports, run logs, some AI token/voice limits | Reliable per-business cost accounting and outcomes tied to authoritative events rather than estimates |

Sources: [chat assistant](../lib/chat/assistant.ts), [chat message route](../app/api/widget/[widgetKey]/message/route.ts), [knowledge profile](../lib/knowledge/profile.ts), [internal CRM writer](../lib/crm/internal.ts), [caller matching](../lib/crm/caller-resolution.ts), [workflow handlers](../lib/workflows/handlers.ts), [capability registry](../lib/packages/capabilities.ts), [automation catalog](../lib/automation-packs/catalog.ts), [presets](../lib/packages/presets.ts), [notifications](../lib/notifications/client.ts), [connected apps beta](30-connected-apps-beta.md).

### Three foundational differences to address

**Website chat currently does intake.** Its prompt is specific to home service businesses. It reads approved knowledge and the current conversation; it does not receive general customer CRM context or tools for completing customer transactions. It explicitly promises that the team will confirm appointment requests.

**The internal CRM is conditional.** The lead writer runs for the lead-intake template and only for the primary, mirror, or assist CRM modes. External-only, webhook-only, and no-CRM configurations do not automatically gain the shared operational record the new product requires. Preserve external-system authority while separating record maintenance from CRM screen visibility.

**Catalog breadth exceeds proven workflow breadth.** A capability name, event type, connector, or “v1” label does not establish a finished customer journey. Several packs are marked for later work, and the seven workflow handlers do not represent every voice, connector, or assistant function in the repository. Count verified outcomes, not cards or handler names.

## Production evidence and limitations

During the discussion, the local test suite completed with 279 passing tests and zero failures, and TypeScript checking passed. These checks support the existing implementation; they do not verify every real provider, a live mobile journey, or a complete new product flow. The documentation update does not change application behavior.

The September 5 hosted deployment notes recorded working protected workspaces, database migrations, and isolated test accounts. They also recorded outstanding live-provider and worker activation. See [hosted beta notes](32-vercel-beta-workspaces.md) and [beta launch guide](28-beta-launch-guide.md).

A later health request at **2026-10-03 01:28:52 UTC** returned unhealthy, with the database unavailable and release attribution unavailable. Its schema result was also marked outdated, but the actual schema version was null; that response cannot establish that migrations are missing. Worker status was not verifiable from that response. Diagnose the hosted state before using it for a pilot. This is a dated observation, not a newly diagnosed root cause.

Code inspection also found recovery and status issues to address in the first supported flow: website-chat completion and Twilio inbound processing call the workflow engine directly rather than consistently using durable queued intake, and provider acceptance of an SMS is treated as successful delivery in the delivery path. Prove recovery after interruption and distinguish accepted, delivered, failed, and unknown external results.

Other launch work includes tested customer opt-out handling, identity verification, readable errors, reconnect behavior, data import/export and offboarding, cost limits, monitored background services, and restore verification. Build these in the flows they support; they should not become a disconnected dashboard project.

## Proposed build sequence

This sequence is a proposal. The booking flow is a way to prove shared records, approvals, and execution; it does not limit the product to customer intake. Marketing, sourcing, purchasing, and operations are core areas in the [expanded blueprint](34-client-product-blueprint.md#marketing-sourcing-purchasing-and-operations). Prove one internal business workflow early, before pursuing broad channel coverage.

### Phase 1 A complete website assistant and owner flow

Start with a business that takes individual appointments. Implement the smallest reusable flow with approved knowledge, a shared customer record, lead capture, a booking request, owner approval, calendar confirmation, and a reminder. Keep voice optional.

Required work:

- Simplify entry into the client product while keeping account provisioning and permissions functional.
- Build the Home decision/activity experience and phone-friendly approval detail.
- Separate internal operational record maintenance from the optional CRM interface; define migration behavior for existing CRM modes.
- Generalize the knowledge/intake schema beyond home service terminology.
- Persist inbound work before acknowledging it, handle retries and duplicate events, and surface failures to an accountable person.
- Join website conversations, customer records, proposed actions, approvals, and executed results into an inspectable history.
- Connect one supported calendar and one supported confirmation channel; state their limits clearly.

Acceptance: a real test visitor asks a question, supplies contact details and a booking preference, and becomes a persisted lead. The owner reviews and approves the request from a phone. The app rechecks availability, creates one event, and issues the configured confirmation/reminder. Duplicate clicks, repeated webhooks, and a worker restart do not create duplicate appointments or messages. A full slot, declined/expired approval, disconnected account, or failed send produces an honest status and recovery path.

Private customer information remains protected. Capturing a new lead does not authorize disclosure of an existing customer's records.

### Early proof of an internal business workflow

Select a bounded workflow from the pilot business's real priorities and available data. Candidates are a marketing opportunity becoming an approved campaign, a sourcing brief becoming an evidence-backed purchase proposal, a stock shortage becoming a tracked requisition, or a service request becoming an assigned and completed checklist.

This proof should establish domain records beyond contacts and appointments. It must produce a persisted business work item, a concrete approval where required, an executed supported action, and an inspectable outcome. A generated paragraph alone is insufficient. External publication or ordering remains unavailable until its provider operation is implemented and verified.

Choose this work before expanding to every messaging channel. The goal is to validate the broader business product while reusing the same permissions, approvals, and durable execution.

### Phase 2 Customer continuity across channels

Add a second channel, preferably SMS or email using existing foundations, to prove shared identity and conversation state before adding more channel providers. Build human takeover, thread assignment, messaging preferences, and conversation-level pause behavior.

Acceptance: a customer can continue a website inquiry through the supported second channel after appropriate identity linking. Staff see one coherent history, duplicate records can be reviewed, and a person with the same display name cannot access another customer's information. An opt-out stops pending and future relevant messages. An owner reply pauses the automated reply path.

Instagram DMs, Messenger, WhatsApp, and further channels follow the same contract. Each needs its own provider permissions, account eligibility, supported message types, delivery events, and end-to-end verification; a Meta lead-ad connection does not fulfill this requirement.

### Phase 3 Business recommendations and guided activation

Turn the existing catalogs into versioned recipes with prerequisites, supported operations, rules, costs, tests, and outcomes. Use the business description and operating model to recommend a few useful capabilities. Guide connection setup and business-rule collection inside the same client workspace, with permissioned implementer access.

Acceptance: an authorized implementer can activate the first supported recipe from the product without editing code, database rows, or undocumented mappings. They can see why a recommendation fits, what is missing, and whether the test actually succeeded. Unsupported tools are labeled honestly. Pausing a recipe prevents new external actions, with explicit treatment of queued work.

### Phase 4 Expand useful work by business area

Expand from the proven flows according to pilot needs. Marketing, purchasing, sourcing, and operations should not automatically wait until every front-office feature is finished. Candidate capability groups are:

- Marketing: capacity/inventory opportunities, campaign proposals, approved publication, results, and follow-up decisions.
- Sourcing: supported source research, retained evidence, supplier/product comparison, and buying recommendations.
- Purchasing: shortage detection, requisitions, supplier selection, approved orders, receiving, and discrepancy handling.
- Operations: work intake, checklists, dependencies, staff assignment, progress, and exceptions.
- Customer lifecycle: lead follow-up, booking, reminders, rescheduling, rebooking, reviews, and payment follow-up.
- Retail: inventory-aware sales, listing proposals, reservations, and fulfillment, using the golf shop as a reference.

Select the next group by the business problem, data readiness, supported external actions, and measurable benefit. A read-only connector or a draft generator does not establish an operational workflow for that domain.

Promote a capability only when its trigger, business rules, record updates, approval path, external action, stop conditions, and failure recovery work together. Do not show unavailable capabilities as active simply because their catalog card exists.

Keep the architecture general while proving a small number of supported business patterns. A hair salon's multi-resource booking and a shop's inventory reservation require actual domain work beyond changing an agent prompt.

### Phase 5 Prove operation with real businesses

Operational hardening runs alongside the earlier phases. Before a paid pilot, verify the deployed services used by the supported flow, authentication, tenant boundaries, notification devices, webhook signatures, provider callbacks, interruption recovery, restore procedures, usage budgets, and support escalation.

The pilot should measure time to activate, time to first useful outcome, failed actions, approval burden, support minutes, provider costs, and observed business outcomes. Agree pilot success thresholds before collecting results. A pilot is ready when a business can operate the supported flow and recover from expected problems, not when the catalog looks extensive.

## Work that remains deferred

The partner's sales CRM, platform-owner CRM, elaborate agency packaging/billing UI, and new enterprise administration are outside the current product build priority. Preserve the minimum administration needed to provision and safely support clients. Broader commercial launch will later need the white-label and agency operations work recorded in the [business model document](33-business-model-and-pricing.md).

## First implementation task

Use Phase 1 as the next bounded implementation scope. Begin by mapping one supported client's setup and approval journey against the existing routes, then specify the customer-record and durable-intake changes before changing screens. The first deliverable should demonstrate a real website inquiry becoming useful, traceable business work in the client app.

No application refactor, provider activation, route deletion, or database migration is performed by this documentation change.
