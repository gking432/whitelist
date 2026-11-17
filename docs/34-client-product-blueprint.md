# Client product blueprint

**Direction update, October 7:** the [revised build plan](38-agent-team-build-plan.md#current-direction--october-7-2026) now governs priorities: a packaged solo-business app plus custom "Agents Built In" implementations. Preserve the setup, shared records, execution, and owner-approval patterns below. The universal department catalog is future scope; purchasing and white-label expansion are deferred, and custom engagements are discovered inside each client's existing systems. References to "current" in the October 2–3 record below describe that earlier direction.

Decision recorded October 2, 2026. Focus development on one product for the business that an agency serves. Table the partner CRM and platform-owner CRM. The business owner should be able to describe their operation, activate useful agents and automations, and oversee results from a simple app.

This document supersedes older partner-first build priorities. It does not remove tenant isolation, permissions, or the agency resale model. [Commercial discussion](33-business-model-and-pricing.md) is preserved separately; [current implementation and build order](35-client-product-readiness-and-roadmap.md) distinguish existing code from proposed functionality.

## Symphony reference and current build priority

On October 3, 2026, the user identified the remembered product as **Symphony** and directed the project to build the business product first, with white-label capabilities added afterward. The matching reference is [Symphony by Wix](https://www.wix.com/symphony). This is the current implementation direction; the older website-chat-first sequence is no longer the complete build assignment.

Wix describes a business-specific setup, specialist agents, connected tools, a single coordinating conversation, proactive work, approvals, and mobile access. Its [launch announcement](https://www.wix.com/press-room/home/post/wix-launches-symphony-by-wix-a-new-standalone-multi-agent-system-built-for-smbs) also describes daily briefings and a separate quality-review layer. These are vendor descriptions reviewed on October 3, not independent verification of Symphony's logged-in behavior or every advertised integration.

Use that product pattern to extend the existing `/Users/gkn/partner-platform` application. Preserve and reuse its CRM, business records, knowledge, connectors, workflow engine, approvals, action queue, and permissions. Keep the source, brand, and design our own. The first deliverable is a useful business operating product; additional agency branding, custom domains, resale packaging, billing, and agency administration follow. Existing tenant isolation and access controls remain foundational.

The business-first [capability catalog](37-business-capabilities-and-business-types.md) remains the scope of business outcomes, including marketing, sourcing, purchasing, and operations. Those areas come from the user's requirements; do not imply that each has been verified in Symphony. Website chat and voice are individual capabilities within this scope.

### Required experience

1. Start with the actual business. The owner or an authorized implementer provides its description, goals, operating model, existing tools, and rules. A simple form and a guided conversation can serve the same setup. Do not make a fictional business the product entry point.
2. Build a reviewable business profile and recommend relevant work. Explain expected outcomes, required connections, missing facts, available actions, and approval rules.
3. Connect and test the required tools through the existing integration system. Activate only the supported operations that passed their checks.
4. Give the owner one place to ask for work, change priorities, and inspect progress. A coordinator routes work to appropriate capabilities and maintains the state of the overall request.
5. Let agents and ordinary automations share scoped business context and operate from actual events or schedules. An owner should not have to press a draft button for every recurring task.
6. Present concrete decisions on the phone, execute authorized actions, verify outcomes, and report exceptions. Owners who only want approvals and app links can keep using that simple view.
7. Maintain a useful activity history and daily briefing with links to actual work. The detailed CRM and business records remain optional views of the same operation.

### Implementation order within the existing application

- **Real setup and activation:** reuse provisioning and connection setup; replace prototype shortcuts in normal product navigation with actual business selection/creation and guided activation.
- **Shared coordinator:** persist business requests, plans, delegated steps, required approvals, execution results, and stop conditions. Use the existing workflow/action infrastructure rather than creating an unrelated execution system. Resuming after an approval or interruption must continue the same work safely.
- **Scoped business context:** expose relevant customers, conversations, products, suppliers, purchases, jobs, knowledge, and preferences to each capability. Corrections should update reviewed business facts without silently changing policy or authorizing new actions.
- **Operational domain capabilities:** connect existing recipes and workflows to actual permitted actions. Advance customer work alongside at least one meaningful marketing, sourcing, purchasing, or operations outcome. Show unsupported publication, research, ordering, and other actions as unavailable with a useful handoff.
- **Proactive operation and quality:** event/schedule triggers, duplicate prevention, freshness checks, factual validation, and review of proposed work before it reaches the owner or an external service. A second model can assist review; deterministic checks and verified results remain necessary.
- **Owner experience and operational proof:** phone approvals, notifications, pause controls, readable failures, usage limits, and inspectable results. Verify the full flow across records, approvals, connected services, and recovery, not just the chat response.
- **White-label commercial layer afterward:** agency onboarding, branding coverage, custom domains, resale/tier management, billing, and broader agency administration once the underlying client product is useful and reliable.

The coordinator is currently a missing capability, not a renamed recipe runner. A screen, catalog entry, drafted proposal, or provider connection alone does not establish that a business job is complete. Preserve existing working journeys and verify them when their entry points or execution paths change.

## Product promise

“Tell us about your business. Connect the tools you use. Choose the work you want handled. We will show you what happened and ask when a decision needs you.”

Agents, deterministic automations, and human actions all operate on the same business records. The owner can inspect or edit permitted records, but routine CRM maintenance should not be required to get value. Voice answering is one optional capability among many. Marketing, sourcing, purchasing, and operations are core product areas alongside customer communication and sales.

### Decisions from the user

- Build the end-business product as the current priority.
- Defer the partner CRM and platform-owner CRM.
- Support multiple business areas and industries over time.
- Include simple automation as well as AI; begin with practical capabilities such as website chat.
- Let supported channels use shared customer records and relevant CRM data.
- Keep an internal operational record even when the owner never opens a CRM.
- Recommend capabilities from the business description and guide the necessary connections.
- Allow the owner or authorized implementer to add other capabilities.
- Support human approvals, including an owner accepting an appointment request from their phone.

The screens, catalog, technical approach, and sequence below are proposed implementation choices. They are not claims that these features already exist.

## The daily experience

The default home screen answers three questions: What needs me? What was handled? What needs attention? It should show concrete business activity with links to the underlying conversation or record.

Example content might be an appointment awaiting confirmation, a lead needing a price decision, a completed follow-up, or a disconnected calendar. These are examples of content to render from real records, never permanent sample metrics.

| Area | What the owner does |
| --- | --- |
| Home | Review decisions, upcoming commitments, completed work, and problems |
| Conversations | Read customer conversations, reply, take over from automation, and see relevant customer history |
| Automations | See recommended and active capabilities; enable, configure, pause, and inspect each one |
| Business | Maintain services or products, hours, policies, staff, locations, knowledge, connections, and notification preferences |
| Records | Optionally inspect customers, campaigns, inventory, suppliers, purchases, jobs, appointments, and tasks as the relevant capabilities are implemented |

Approvals should be available directly from Home and notifications. Support should be easy to reach. A general “Ask my business” assistant and work coordinator are now part of the active product scope. They use the same records and execution services; routine scheduled work and phone approvals must also function without requiring a fresh conversation.

The app should work well on a phone. A responsive web experience is the first surface; installability and push notifications require their own implementation and device verification. A branded native mobile app is a separate distribution decision.

## Setup from a business description

1. **Describe the business.** Accept a description such as “I run a hair salon,” with optional website and existing system names. Infer a draft profile, then ask for the few facts that change behavior.
2. **Identify the work.** Ask about priorities such as generating demand, finding inventory or suppliers, replenishing stock, completing jobs, replying faster, filling appointments, collecting payments, or reducing admin.
3. **Recommend a small starting set.** Explain why each capability fits, what it does, which connections it needs, and whether it acts automatically or asks first. Keep the wider catalog available.
4. **Connect only what is needed.** Select the relevant inbox, calendar, booking system, website, CRM, commerce, inventory, advertising, supplier, or accounting account. Explain permissions and any additional cost. Reuse an existing connection across capabilities.
5. **Confirm business rules.** Review services, prices, hours, availability, staff/resources, cancellation rules, brand guidance, supplier preferences, stock targets, spending limits, escalation contacts, and allowed actions as relevant. Website imports are proposed information for review, not automatically authoritative policy.
6. **Test the actual outcome.** Run a clearly labeled test with the relevant provider and safe test recipient. Verify the record, approval, external action, and result. A connected account alone is insufficient.
7. **Activate and observe.** Show active capabilities, who receives exceptions, current limits, and the next expected event. Let the owner pause a capability immediately.

Suggested activation states are Recommended, Needs connection, Needs business information, Ready to test, Active, Needs attention, and Paused. The product must explain what prevents activation and preserve progress when setup is interrupted.

Do not treat the industry label as a complete configuration. Two trainers may run private sessions, group classes, or online subscriptions. A salon may require both a stylist and a chair. Ask about the operating model before choosing booking behavior.

## Capabilities across the business

This is a proposed catalog of useful jobs. Some have partial foundations today; others require new domain models and integrations. The readiness document identifies that distinction. Plain automation should handle predictable rules; AI adds value where language, classification, retrieval, or judgment is needed.

| Business area | Useful simple automation | What AI can add |
| --- | --- | --- |
| Customer questions | Website contact capture, hours, FAQs, routing, human handoff | Answer from approved knowledge and relevant permitted customer context |
| Messages across channels | Record messages, route to the right person, assign conversations, prevent duplicate replies | Summarize history and continue an inquiry across supported, linked channels |
| Lead intake and sales | Create customer/lead records, assign owners, remind staff, stop follow-ups when someone responds | Qualify needs, identify missing information, draft personalized follow-ups |
| Scheduling | Offer valid slots, request approval, confirm, remind, cancel, reschedule, manage a waitlist | Understand preferences expressed in natural language and suggest suitable options |
| Quotes and proposals | Collect required fields, use approved price rules, request approval, track acceptance | Draft scope and explain options using the business's actual services |
| Payments and collections | Send approved payment links, invoice reminders, receipts, stop reminders after payment | Explain an invoice or draft a tactful reminder from verified billing data |
| Service delivery | Intake forms, checklists, task assignment, progress updates, completion notices | Summarize a request or job, extract tasks and missing information |
| Retention and reputation | Rebooking reminders, renewal dates, eligible review requests, referral follow-up | Personalize outreach and summarize feedback with escalation for unresolved issues |
| Marketing | Run approved campaigns, schedule content, maintain audience preferences, record leads and conversions | Identify opportunities from capacity or stock, propose offers, create content, and recommend changes from results |
| Inventory and resale | Track stock, reserve items, alert on low stock, flag stale listings | Answer inventory questions, draft listings, research purchasing opportunities |
| Sourcing | Monitor approved catalogs or feeds, filter opportunities, track supplier availability and price changes | Find products or suppliers, compare evidence, estimate landed cost, and prepare a shortlist |
| Purchasing | Reorder thresholds, purchase approvals, order tracking, receiving, invoice matching | Explain quantity recommendations, compare supplier quotes, flag substitutions or discrepancies |
| Administration and documents | Collect missing forms, organize attachments, populate templates, track deadlines | Extract document fields, summarize correspondence, answer staff policy questions |
| Staff coordination | Assign tasks, send shift reminders, track onboarding checklists | Summarize handoffs and find procedures; employment decisions remain with people |
| Owner oversight | Daily summaries of activity, overdue work, failed actions, and spending | Explain trends with supporting records and suggest next actions |

Track outcomes appropriate to each job: response time, qualified inquiries, confirmed appointments, no-shows, overdue tasks, collected payments, repeat bookings, or inventory aging. Distinguish measured outcomes from estimated time savings or revenue influence.

## Marketing sourcing purchasing and operations

These areas should perform recurring work triggered by business events, schedules, and owner requests. Each needs persistent work items and a useful result, rather than requiring the owner to start a fresh chat each time. The examples below are proposed capabilities, not descriptions of current end-to-end implementation.

### Marketing

Use business goals, available capacity, inventory, approved offers, brand guidance, customer preferences, and campaign results to identify what to promote. A salon with open appointment slots and a shop with aging inventory need different campaigns.

An initial useful flow is: detect an opportunity, recommend an eligible audience and offer, prepare the content, obtain the required approval, publish or send through a supported connection, and record responses or conversions. Follow-up work can compare results and propose the next change. Distinguish observed conversions from uncertain attribution.

Capability examples include local content, social posts, email/SMS campaigns, customer reactivation, service-page drafts, listing improvements, and paid-campaign recommendations. Begin with one supported publication channel; additional channels and ad-spend changes each need explicit implementation and permissions.

The owner should receive a concrete proposal such as “There are unused appointments next week; review this campaign for eligible past customers.” Show the audience, offer, channels, timing, and any spending. Approval of content does not automatically authorize a new budget or a different audience.

### Sourcing

Sourcing finds and evaluates possible suppliers, products, materials, or resale inventory before a purchasing decision. For a reseller, it could compare buying opportunities against current inventory, observed demand, expected selling price, fees, shipping, condition, and target margin. For a service business, it could identify alternate suppliers for materials or consumables.

An initial useful flow is: define a buying brief, search supported sources, remove duplicate opportunities, retain source evidence and timestamps, calculate comparable costs, and produce a ranked shortlist. Explain missing information and why each opportunity fits. Asking prices and actual completed-sale evidence must remain distinguishable.

The owner sees a recommendation with its evidence, assumptions, expected costs, and proposed next step. Supplier outreach or requesting a quote is a separate permitted action. If a source lacks supported access, the app must not pretend it is continuously monitored.

### Purchasing

Purchasing turns an approved need into an order and tracks what happens afterward. Use on-hand stock, reservations, consumption, confirmed inbound orders, supplier terms, lead times, and budgets to calculate what to buy. Checking existing inbound orders prevents duplicate replenishment.

An initial useful flow is: identify a shortage, prepare a purchase requisition, select an approved supplier or sourcing recommendation, request approval, submit through a supported purchasing channel, track acknowledgment and arrival, and reconcile what was received. A purchase-order record is not proof that the supplier accepted an order.

The owner sees supplier, item, quantity, total expected cost, delivery assumptions, and the effect on the budget. Initial ordering should require approval. Later, an owner may configure bounded repeat orders from approved suppliers; changed prices, substitutes, larger quantities, or budget overruns require renewed review.

### Operations

Operations moves work through the business and resolves exceptions. Its records include jobs, orders, tasks, checklists, staff responsibilities, material needs, deadlines, and dependencies. A briefing is useful, but the capability should also assign and track actual work.

An initial useful flow is: receive an accepted order or service request, create the required work items, check readiness, assign responsible staff, collect progress, flag missing materials or overdue steps, and prepare the appropriate customer update. Staff confirm physical completion; an agent cannot infer that an item shipped or a repair finished merely because a deadline passed.

Examples include missing intake documents, unassigned jobs, supplier delays, incomplete receiving, inventory discrepancies, overdue repairs, and orders ready for pickup. Routine tasks can proceed under configured rules; the owner sees decisions requiring changed priorities, spending, refunds, or commitments.

### How the areas work together

A proposed golf-shop sequence is: sourcing finds a promising item; purchasing prepares the buying decision; operations records receipt, condition, and availability; listing/marketing prepares the promotion; sales handles the inquiry; fulfillment records the completed handoff. Each stage uses the actual result of the previous stage. Marketing must not advertise an unreceived item as available stock unless an explicit preorder policy permits it.

A salon could use booking history to estimate consumable demand, purchasing to propose replenishment, operations to flag missing supplies, and marketing to promote genuinely available appointments. The business should enable only the relevant parts of this sequence.

Each domain shares the same approval and action history, but has its own records, permissions, and authoritative source. Keep supplier negotiations, acquisition cost, customer-private information, and staff details available only to the roles and tasks that need them.

### Initial capabilities to package

Initial packages should depend on the business's priority. An appointment business might start with website answers, booking requests, and follow-up. A reseller might start with sourcing shortlists, listing proposals, and inventory tasks. A service operation might start with intake, work checklists, and exception handling. Every package should use the same owner approval inbox and activity history.

The booking journey in the build plan is a proposed first technical proof, not the definition of the entire product. Prove an internal business workflow early as well, selected from marketing, sourcing, purchasing, or operations according to available real data and the pilot's need.

A capability can contain both an agent and ordinary automation. For example, AI understands a scheduling request, deterministic rules calculate permitted slots, the owner approves when required, and a durable job writes the calendar event. The model should not invent availability or replace transaction logic.

### Examples for different businesses

| Business | Suggested starting set | Information that changes the implementation |
| --- | --- | --- |
| Personal trainer | Consultation booking, intake, reminders, client reactivation, campaign proposals | Private versus group sessions, capacity, packages, customer preferences, calendar |
| Hair salon | Stylist booking, rebooking campaigns, supply replenishment, daily operations checklist | Service duration, stylist skills, stock usage, suppliers, deposits, booking system |
| Golf shop or reseller | Sourcing, purchase proposals, inventory tasks, listing drafts, buyer follow-up | Buying criteria, inventory authority, condition, pricing limits, supported sources and sale channels |
| Home service business | Lead intake, estimates, material sourcing, purchasing, job coordination | Service area, job types, supplier terms, material requirements, dispatch system |
| Professional service firm | Inquiry qualification, consultation booking, document collection, status updates | Engagement rules, information permissions, document system, approval owner |

These are reusable combinations, not five separate applications. Appointment businesses, inventory businesses, project businesses, and recurring-service businesses share patterns but need different rules.

## Shared business records behind every capability

Give each business its own canonical customer records, with linked channel identities, conversations, preferences, leads, appointments, tasks, and action history. Agents should use a shared context service that returns only the facts relevant to their role and the current interaction.

Customer records are one part of the underlying system. Marketing also needs campaigns, assets, audiences, offers, and results. Sourcing needs opportunities, supplier/product candidates, comparable evidence, and buying criteria. Purchasing needs requisitions, approvals, orders, receipts, and invoice references. Operations needs jobs, stock movements, tasks, dependencies, and staff responsibilities. These are proposed domain models, not existing tables implied by the presence of a CRM.

Build these records as needed by working capabilities, with stable references between domains. Share access through scoped tools; do not put the entire business database into every agent's prompt.

Visibility of CRM screens must be independent of whether the product maintains operational records. The current code ties some internal CRM writes to selected CRM operating modes; changing that is foundational work, not a navigation toggle.

When a business already uses a CRM, booking app, commerce system, or accounting system, identify which system is authoritative for each kind of information. Keep the local operational record and external IDs needed for automation. Avoid indiscriminately copying every field or letting two systems overwrite each other. Display stale or unavailable data honestly.

### Recognizing a customer across channels

Within a business, connect verified email, phone, authenticated website identity, and provider-scoped social identities to the same customer where appropriate. Maintain the source and confidence of each association. Ambiguous matches require review, and mistaken merges must be reversible.

Someone typing an email address into a public chat is not proof they own that account. A phone-number match can suggest context without authorizing disclosure of private appointment, order, or payment details. Private actions and private information require verification appropriate to the action. Shared household phone numbers and conflicting records must not silently merge people.

Separate public business knowledge from private customer information. Customer identity and memory are scoped to the client business; two businesses served by the same agency do not share customer histories by default.

### One conversation and one decision history

Each message should identify its business, channel, customer association, author, timestamps, and provider reference. Record who is handling the conversation so the owner and agent do not reply simultaneously. Handoff pauses automated replies until the permitted return to automation.

Every proposed action should retain its inputs, applicable business rule, permission check, approval if required, execution status, provider reference, and final result. Other agents can then see that a booking or follow-up has already happened instead of repeating it.

## Approvals and autonomy

Each capability needs an understandable setting: suggest only, ask before acting, or act within specified rules. Start bookings with owner approval, matching the requested experience. Public FAQ answers and carefully configured reminders can operate automatically within approved policy once their workflow is proven.

A booking approval should show the customer, service, staff/resource, time zone, duration, price or deposit where applicable, and the exact consequence of accepting. Owners can approve, decline, or request a change. Editing a proposal invalidates approval of its previous contents.

After approval, check availability again before confirming. If a slot has been taken, present alternatives rather than inventing success. If an approval expires or the owner does not respond, notify the appropriate person and tell the customer the request remains unconfirmed. Configure backup approvers and quiet hours where needed.

Do not require approval for every minor event forever. The goal is to reduce work while keeping meaningful decisions with the owner. Measure approval volume, time waiting, and repeated edits to improve defaults.

## How recommendations become working capabilities

Use versioned recipes with explicit prerequisites and a known implementation. Each recipe should define:

- The outcome and applicable business operating models.
- Required information, connections, and supported provider operations.
- Events that start it and conditions that stop it.
- Records and tools it can read or change.
- Business rules, autonomy level, approval owner, and spending limits.
- A test scenario, expected external result, and activation requirements.
- Failure handling, duplicate prevention, pause behavior, and recovery instructions.
- Outcome metrics and the sources supporting them.

AI can interpret the business description and recommend recipes from this catalog. It must not invent production integrations or quietly generate unrestricted workflows. Unavailable capabilities should say what is missing and offer a supported alternative or a request path.

Each additional agent should use the shared identity, knowledge, permissions, action history, and execution services. Add domain-specific tools and rules where needed. Avoid separate customer databases and inconsistent approval mechanisms for each agent.

## Extending the golf shop work

The separate golf shop project contains useful patterns for procurement research, listing drafts, inventory-aware sales assistance, scheduling, service intake, follow-up, and an owner operations summary. Its bounded tools and proposal/approval pattern are relevant examples.

That project is built around one shop. Its authentication, ownership assumptions, data model, and external-system limitations must be adapted before reuse here. Treat its seven agent roles as design and code references, not seven production-ready modules that can simply be switched on.

Start by generalizing inventory lookup and listing proposals into a retail capability pack. Add purchasing recommendations after inventory authority, pricing calculations, approvals, and cost accounting are established. Marketplace publishing, shipping, payments, and external calendar synchronization are separate supported operations to implement and verify.

Reference project: `/Users/gkn/Documents/ChatGPT/Golf Store`. The current documentation work does not change that project.

## Work deferred by this decision

Agency sales pipelines, the platform owner's CRM, more role-selection dashboards, and expansion of partner business-management features are tabled. The detailed client CRM remains an optional view of the client's records. Preserve the minimum account provisioning, access controls, tenant boundaries, branding, configuration, and troubleshooting needed to deliver the client product.

This is a change in product priority. Existing owner and partner routes have not been removed by this documentation update. Any later navigation simplification must preserve authorized access and a usable way to configure and support a client.
