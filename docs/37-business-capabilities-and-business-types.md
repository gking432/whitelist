# Business capabilities and business types

**November 5 current sequence:** the [complete product roadmap](44-nightly-launch-roadmap.md) orders the core app capabilities. This document supplies the broader business outcome and extension catalog. Google setup is one foundation package; the full product includes coordinated work and workflow improvement.

**Direction update, October 7:** use the [revised build plan](38-agent-team-build-plan.md#current-direction--october-7-2026) for priorities. This is a broad opportunity inventory, not a launch checklist or a universal enterprise agent catalog. The current two offers are the directly delivered solo-business app and custom workflow implementations; white-label agency sales are deferred. Purchasing/sourcing are optional specialist work. The October 3 implementation evidence below has not been freshly verified against live providers.

Recorded October 3, 2026. This is a business-first catalog for the existing partner platform: the problems it should solve, the implementation already present, the proposed additions, their limits, and the businesses they could serve. It expands the client product blueprint without creating a new application or restarting the project.

The user subsequently identified Symphony by Wix as the product reference and directed us to build the business-owner product first, then add the remaining white-label layer. The [updated blueprint priority](34-client-product-blueprint.md#symphony-reference-and-current-build-priority) governs implementation. This catalog remains our business scope; it is not a claim that Symphony implements every listed capability.

In the earlier resale model, the paying customer was the local agency, configuring and selling the product under its own brand. That commercial rollout is deferred under the October 7 direction. Partner sales CRM and platform-owner CRM development remain deferred. The business owner can use a simple phone approval and activity view while the software maintains the underlying business records.

## How to read the inventory

**Current implementation** means behavior found in the repository. It does not mean a provider is connected, a feature is active for a particular client, or the complete hosted workflow has passed live verification. The latest local check found no configured drafting or voice model credentials; that observation does not establish the state of another deployment.

**Proposed additions** describe the product scope to build and validate. They are not shipped features or a promise that every provider and business type will be supported at launch. **Limits** distinguish work requiring a person, business rules, or a supported integration from work the software can reasonably own.

Three mechanisms can contribute to one business outcome:

- **Automation:** performs a defined action when a condition is met, such as reminding an eligible customer before a booking.
- **AI assistance:** understands, extracts, drafts, or analyzes information, such as turning an inquiry into a proposed scope of work.
- **Agent:** pursues a bounded business job across steps, uses connected tools, checks outcomes, and pauses for approvals or exceptions. A saved draft or a recurring calculation alone is not a completed agent.

The business should choose outcomes such as “follow up on open estimates” or “keep supplies in stock.” These mechanisms should be explained when useful, without making the owner manage a collection of AI personalities.

## Business problems and product scope

### 1 Generate demand and use available capacity

**Problem:** Marketing happens inconsistently; empty appointments and slow-moving stock are not promoted effectively.

**Current implementation:** Campaign records and approvals, marketing-copy and product-listing draft recipes, and existing CRM source and conversion reporting. Draft recipes use the existing model provider when configured and templates otherwise. Approving a new workspace campaign does not publish it.

**Proposed additions:** Detect real spare capacity, aging inventory, seasonal opportunities, and eligible customer segments. Prepare a campaign with audience, offer, copy, assets, channel, timing, and cost. Publish or send approved campaigns through supported connections, observe results, and suggest the next change. Include social posts, email/SMS campaigns, service-page drafts, local listing improvements, and later paid-ad proposals. Image generation and website publishing would be additional integrations, not existing capabilities.

**Mechanisms:** Scheduled publication and audience rules are automation; content and opportunity analysis use AI; a marketing agent manages proposal → approval → publication → results.

**Limits:** No guaranteed leads, search rankings, or sales. No invented discounts, reviews, availability, or product claims. New spend, audiences, offers, and material strategy changes need configured authority or approval. Advertising optimization is a later capability, not a current autonomous ad buyer.

### 2 Capture inquiries and answer customers

**Problem:** The owner misses inquiries while working, and customers repeatedly ask the same questions.

**Current implementation:** Website chat using approved business knowledge, lead and contact extraction, intake classification, shared CRM writes, response drafts, and SMS/email sending infrastructure. Public chat currently has limited context and is not a verified customer-account portal.

**Proposed additions:** Consistent conversations across supported website, SMS, email, and eventually Instagram, Messenger, and WhatsApp channels. Link verified identities, preserve conversation history, answer permitted order/booking questions, route work, and support human takeover.

**Mechanisms:** Capture, assignment, and record updates are automation; understanding and responses use AI; a customer-service agent resolves supported requests and escalates the rest.

**Limits:** A Meta lead connector is not an Instagram messaging agent. Each channel needs its own working integration. A name, phone, or email match alone does not authorize disclosure of private records. Unsupported answers and unusual commitments go to a person.

### 3 Handle phone work when the business needs it

**Problem:** Calls interrupt staff or go unanswered.

**Current implementation:** Inbound AI voice runtime, a staff call assistant, transcripts and summaries, contact capture, notes, calendar-slot proposals, booking and confirmation requests, and explicitly initiated outbound callbacks. These depend on configured voice infrastructure and providers.

**Proposed additions:** Business-specific call flows, controlled callback scheduling, better handoffs, and supported transfer behavior. Keep voice optional in setup and pricing.

**Mechanisms:** Call routing and follow-up scheduling are automation; conversation and summarization use AI; the voice agent invokes limited customer and booking tools.

**Limits:** Current escalation flags human follow-up; it does not guarantee a live transfer or callback time. The app should not run unrestricted cold-calling campaigns or make unsupported promises. Voice is not required for the rest of the product.

### 4 Convert inquiries into accepted work

**Problem:** Leads disappear, estimates receive no follow-up, and quoting consumes the owner's time.

**Current implementation:** Lead analysis, intake routing, suggested follow-up tasks, first-response and estimate-follow-up drafts, CRM quote records, and a ballpark estimator. The estimator is a deterministic calculation using fixed home-service rates; it is not a general AI pricing engine or a client-approved price book.

**Proposed additions:** Collect missing scope, qualify using business-defined criteria, draft options from the client's actual price book, request review, send supported proposals, track acceptance, and follow up until a defined stop condition. Later support deposits and signature-provider workflows.

**Mechanisms:** Follow-up timing and status transitions are automation; scope extraction and writing use AI; a sales follow-up agent manages the next permitted action.

**Limits:** No invented prices, binding quotes without approved rules, arbitrary discounts, technical inspection, or guaranteed close rate. Replies, declines, opt-outs, and accepted work must stop or change the follow-up sequence.

### 5 Fill appointments and reduce avoidable gaps

**Problem:** Booking requires back-and-forth, cancellations leave gaps, and staff spend time sending reminders.

**Current implementation:** Calendar availability, appointment proposals, approval-based booking execution, confirmation drafts, and native CRM reminder-event production. The reminder handler currently uses confirmation-style drafting; full reminder wording and delivery behavior need verification.

**Proposed additions:** Configurable approval or automatic booking within approved rules; reminders, cancellations, rescheduling, waitlists, deposits, no-show follow-up, recurring appointments, and later staff/resource/group capacity support.

**Mechanisms:** Availability, capacity, and appointment writes use deterministic rules; AI interprets preferences; a booking agent coordinates supported steps and handles exceptions.

**Limits:** A salon's stylist/chair requirements and a trainer's group-class capacity need specific implementation. No invented availability, double-booking, unauthorized fees, or rescheduling outside the allowed policy.

### 6 Onboard a new customer without chasing everything manually

**Problem:** Accepted customers arrive without the forms, information, payment, or documents required to begin.

**Current implementation:** Customer records, tasks, notes, procedures, and intake fields provide part of the foundation. A complete onboarding sequence is not implemented.

**Proposed additions:** Send a welcome sequence, collect business-specific forms and documents, track required steps, request missing items, arrange kickoff, and hand completed intake to operations. Signature and deposit collection require supported providers.

**Mechanisms:** Checklists and reminders are automation; field extraction and summaries use AI; an onboarding agent moves each customer toward readiness.

**Limits:** The system cannot complete a customer's form for them, invent answers, or certify that a signed document is legally sufficient. A professional decides whether the customer is ready for regulated services.

### 7 Deliver jobs and orders reliably

**Problem:** Tasks are missed, responsibilities are unclear, and customers must chase status.

**Current implementation:** Jobs with assignees, priorities, due dates, checklists, blocked/started/completed states, plus saved operations briefings. The briefing primarily summarizes recorded work; it does not autonomously dispatch a team.

**Proposed additions:** Turn accepted work into checklists and assignments; check material and document readiness; track dependencies; request progress; flag delays; and prepare or send permitted status updates. Add recurring service schedules, inspection evidence, and supported delivery-system updates.

**Mechanisms:** Task creation, deadlines, and notifications are automation; summaries and exception explanations use AI; an operations agent follows work to a verified outcome.

**Limits:** People perform the physical work and verify completion. A deadline passing is not evidence that a repair, delivery, or service occurred. Advanced routing, manufacturing planning, and trade-specific dispatch are separate extensions.

### 8 Resolve problems and keep customers returning

**Problem:** Complaints go unnoticed, satisfied customers do not return, and review requests are inconsistent.

**Current implementation:** AI/fallback feedback sentiment and risk analysis, suggested responses, manager-task creation, review-request drafts, review/rebooking drafts, and customer-follow-up drafts. Native CRM completion events can enter the review workflow.

**Proposed additions:** Track support cases through resolution, trigger appropriate rebooking and renewal sequences, identify lapsed customers, manage referral follow-up, summarize recurring complaints, and propose remedies within policy. Expand loyalty support only with a defined program and provider.

**Mechanisms:** Case deadlines, renewal dates, and eligibility are automation; feedback analysis and personalization use AI; a retention/service-recovery agent selects and follows permitted next steps.

**Limits:** No fabricated reviews, hiding complaints, guaranteed retention, or unapproved refunds. Review eligibility should use consistent completion rules rather than suppressing negative customers. Sensitive or disputed cases go to staff.

### 9 Collect payment and understand outstanding money

**Problem:** Invoices are forgotten, payment status is unclear, and reminders continue after a customer pays.

**Current implementation:** Quote/invoice records, a selected-invoice reminder draft, and accounting/payment connector foundations. Marking a workspace invoice paid is an internal record change, not payment collection or verified bank reconciliation.

**Proposed additions:** Create or synchronize supported invoices, send approved payment links, reconcile authoritative payment events, stop paid-invoice reminders, flag overdue balances, and summarize expected receipts. Later add subscription renewal and failed-payment recovery for supported providers.

**Mechanisms:** Due dates, payment events, and reminder stops are automation; explanations and reminder wording use AI; a receivables agent follows permitted unpaid balances.

**Limits:** No independent bank transfers, changes to payment instructions, tax filing, payroll, lending decisions, or replacement of an accountant. Disputes, write-offs, refunds, and new collection terms require the appropriate human authority.

### 10 Find products materials and suppliers

**Problem:** Owners spend hours searching for stock, comparing vendors, and estimating whether a deal is worthwhile.

**Current implementation:** Supplier and opportunity records, saved source links, landed-cost and expected-margin calculations, ranked comparison of entered opportunities, and linked purchase proposals. There is no live discovery or continuous marketplace monitoring.

**Proposed additions:** Search explicitly supported sources from a buying brief; retain evidence and timestamps; compare condition, shipping, fees, terms, and lead times; alert on matching opportunities; and prepare quote requests. Supplier outreach is a separate approved action. Completed-sale evidence should be distinguished from asking prices.

**Mechanisms:** Feed monitoring and filters are automation; evidence extraction and comparison use AI; a sourcing agent researches a brief and maintains a shortlist.

**Limits:** No claim to search every marketplace, inspect physical condition, prove authenticity, guarantee resale profit, or discover private supplier terms. Missing evidence and stale prices must remain visible.

### 11 Buy supplies and receive what was ordered

**Problem:** Supplies run out, duplicate orders occur, and nobody follows up on missing deliveries.

**Current implementation:** Inventory thresholds, replenishment proposals accounting for open requests, purchase approvals, manually recorded external order references, and full-quantity receipt into linked local inventory. Actual ordering is not implemented.

**Proposed additions:** Calculate needs using consumption, reservations, inbound stock, and supplier lead times; select approved suppliers; submit approved orders through supported channels; track acknowledgments; handle partial receipts; and flag price or quantity discrepancies. Later permit bounded repeat orders where the owner explicitly configures suppliers and spending limits.

**Mechanisms:** Thresholds and order/receipt checks are automation; quote comparison and substitution explanations use AI; a purchasing agent coordinates the requisition-to-receipt process.

**Limits:** No spending outside granted authority, silently accepting changed terms, ordering twice after an uncertain result, or claiming a supplier accepted an order without evidence. Supplier portals without supported access require a handoff.

### 12 Sell stock and fulfill orders

**Problem:** Stock counts drift, listings take too long, items oversell, and fulfillment updates are missed.

**Current implementation:** Local product records and stock, purchase receipt updates, selected-product listing drafts, and buying-opportunity comparisons. These records are not a complete synchronized commerce system.

**Proposed additions:** Read and update supported inventory systems; track reservations, aging, locations, and returns; propose markdowns within price rules; publish approved listings; answer verified order-status questions; prepare pick/pack/pickup tasks; and record shipping or collection from the authoritative source. Later add multi-channel allocation and replenishment forecasting.

**Mechanisms:** Stock movements and order-state updates are automation; listing content and merchandising suggestions use AI; inventory/merchandising and fulfillment agents manage their respective work.

**Limits:** No automatic product authentication, physical stock count, packing, shipping, or unrestricted repricing. Multiple sales channels must share a defined inventory authority before the product can promise oversell prevention.

### 13 Reduce paperwork and preserve business knowledge

**Problem:** Documents are scattered, staff repeat questions, and information is retyped between systems.

**Current implementation:** Approved business knowledge, structured business settings, and a tool that turns pasted notes into procedures/checklists. Saving an internal document does not automatically approve it for customer-facing answers.

**Proposed additions:** Ingest supported documents and inbox attachments, extract fields, route files to the appropriate work item, fill templates, request missing documents, and answer staff questions with source references. Website and document imports should produce reviewable knowledge updates.

**Mechanisms:** Routing, templates, and deadlines are automation; extraction, summarization, and retrieval use AI; a document agent tracks collection and processing.

**Limits:** No assumed OCR, access to every file store, guaranteed extraction accuracy, or unreviewed policy changes. Contracts, specialist interpretations, and uncertain source material require review.

### 14 Coordinate staff and recurring internal work

**Problem:** The owner repeatedly assigns routine duties and explains handoffs.

**Current implementation:** Assignees, tasks, checklists, procedures, and work summaries. These are not a full workforce scheduling or HR system.

**Proposed additions:** Recurring opening/closing duties, shift reminders, onboarding/training checklists, shift handoffs, assignment rules, and acknowledgment tracking. Propose staffing gaps from bookings or work volume where reliable data exists.

**Mechanisms:** Recurrence and assignments are automation; handoff summaries and procedure retrieval use AI; an internal coordinator follows task completion and escalates gaps.

**Limits:** No autonomous hiring, firing, pay changes, discipline, or payroll. Labor planning, timekeeping, and specialist workforce requirements need dedicated integrations and human decisions.

### 15 Give the owner oversight without daily CRM work

**Problem:** The owner has to inspect several applications to discover what needs attention.

**Current implementation:** Simple mobile web approval/app/activity view, optional detailed CRM, saved owner briefings, workflow/action logs, and reporting foundations. Mobile push and an installable app experience are not complete.

**Proposed additions:** Verified phone notifications, deadline-aware approval routing, daily/weekly summaries, exception alerts, delegated approvals, and an “ask my business” assistant that answers from permitted records and proposes traceable actions. Larger teams can add manager/location views.

**Mechanisms:** Notification rules and aggregation are automation; explanations and question answering use AI; an owner-support agent finds evidence and coordinates permitted follow-up.

**Limits:** No invented ROI, guaranteed time savings, invisible decisions, or universal access to staff/customer data. Owners should not need to approve every routine FAQ reply; approval levels must match the action and business rules.

### 16 Keep connected systems and records dependable

**Problem:** Disconnected accounts, duplicate records, or failed updates silently stop the work.

**Current implementation:** Tenant permissions, shared CRM records, connector setup, CRM synchronization paths, queues/retries, action history, reported sync-failure handling, and some connection-health reporting. These foundations are not proof of automatic recovery for every provider.

**Proposed additions:** One partner-led real-client setup flow; capability recommendations by business model and goals; guided permissions and connection tests; field mapping; identity-link review; continuous health checks; stale-data detection; reconnect steps; pause controls; and recoverable exports/offboarding.

**Mechanisms:** Health checks, retries, and validation are automation; explanations and mapping suggestions can use AI. A bounded connection-support agent may diagnose a failure and propose a fix.

**Limits:** No integration simply because an app is named in a form. Each supported operation needs implementation, permission, and verification. Do not silently merge ambiguous customers, overwrite an authoritative system, or automatically repair uncertain money/booking actions by repeating them.

## Explicit inventory by mechanism

### AI assistance with implementation today

- Website answers grounded in approved business knowledge, with contact/request extraction.
- Lead analysis and intake routing, including urgency and missing information.
- First-response, missed-call, estimate-follow-up, appointment-confirmation, and review-request drafts.
- Feedback sentiment/risk analysis, suggested response, and manager follow-up task.
- Voice conversation, call summaries, staff assistance, and tool-assisted booking proposals.
- New workspace drafts: marketing, product listing, customer follow-up, review/rebooking, invoice reminder, and procedure/checklist writing.

These use model integrations when configured. Templates or rules are fallbacks, not evidence that a model ran. The quote estimator, reorder calculation, sourcing arithmetic, operations summary, owner counts, and business recommendation weights are currently deterministic functionality.

### Automation with implementation today

- Receive supported lead events; persist contacts, notes, workflow runs, and proposed actions.
- Prepare approval requests and execute supported approved SMS/email/calendar actions through configured providers.
- Produce opted-in native CRM events for appointments within 24 hours, sent estimates after three days, and completed appointments entering the review workflow. Workflow activation, runtime mode, workers, and approval/delivery settings still determine execution.
- CRM create/update synchronization and reported synchronization-failure handling.
- Purchase proposal deduplication, approval state transitions, recorded-order prerequisites, and local inventory receipt updates.
- Four scheduled internal recipes: sourcing comparisons, replenishment planning, operations briefings, and owner briefings.
- Existing queued-action retries, execution history, and some notification/reporting paths.

### Agent implementation today and proposed roles

The existing voice assistant is the clearest implemented tool-using agent. Website chat and intake workflows are bounded assistants; the newer business recipes are mostly single-output tools or rules. There is not yet a complete set of agents autonomously running the business.

Proposed roles are: customer service, optional voice reception, lead follow-up, booking, customer onboarding, marketing, service recovery/retention, receivables, sourcing, purchasing, inventory/merchandising, fulfillment, operations, documents/knowledge, staff coordination, owner support, and connection support. These are responsibilities over shared records, not seventeen separate applications or a requirement to deploy seventeen models. A deterministic workflow should own any job it can perform reliably without AI.

An agent is complete only when it can detect or receive the business need, obtain the right facts, propose or execute a permitted action, wait for any required approval, verify the external result, update records, stop when the goal changes, and expose a recoverable failure. A prompt, menu item, or successful draft does not meet that definition.

## Potential businesses

These are product-fit hypotheses based on work patterns, not validated market demand or a claim that all these industries are supported today. Size describes the operation here rather than a formal business-size classification.

| Business group | Solo and small examples | Mid-sized examples | Problems to solve first | Additional requirements |
| --- | --- | --- | --- | --- |
| Personal appointments | Personal trainers, independent coaches, tutors, music teachers | Training studios, tutoring centers, lesson schools | Inquiries, intake, scheduling, reminders, rebooking | Group capacity, packages, recurring sessions, guardian permissions where relevant |
| Beauty and personal care | Barbers, stylists, nail/lash technicians, estheticians, massage practices | Salons, spas, multi-location beauty businesses | Booking gaps, rebooking, consumables, daily checklists | Staff skills, service durations, chairs/rooms, deposits |
| Home and field services | Cleaners, handymen, painters, lawn/pool care, mobile detailers | HVAC, plumbing, electrical, roofing, pest control, landscaping firms | Lead response, estimates, materials, dispatch handoffs, collections | Territories, technician skills, travel, recurring visits, field-service systems |
| Repairs | Bicycle repair, golf-club repair, appliance/electronics repair | Auto repair, equipment service, multi-technician repair shops | Intake, diagnosis handoff, parts, estimate approval, status and pickup | Asset/serial records, parts compatibility, labor rules, physical diagnosis |
| Retail and resale | Golf shops, vintage sellers, consignment sellers, collectibles and used-equipment resellers | Specialty retailers, refurbishers, multi-store resale operations | Sourcing, buying, listings, inventory, fulfillment | Condition evidence, channel fees, returns, inventory authority |
| Local stores and ecommerce | Florists, gift shops, pet-supply stores, small online brands | Multi-location specialty stores and growing commerce brands | Stockouts, stale stock, campaigns, order questions, replenishment | POS/store integration, variants, locations, shipping |
| Project and creative services | Photographers, designers, consultants, videographers | Creative agencies, event-production and professional-service teams | Qualification, proposals, onboarding, files, deadlines, billing | Project scope, milestones, revisions, retainers |
| Print and custom production | Sign makers, engravers, custom apparel sellers | Print shops, promotional-product suppliers, small fabrication teams | Quote intake, artwork approval, supplies, job tracking | Specifications, proof approval, production capacity; no assumed manufacturing system |
| Recurring services and memberships | Solo recurring cleaners, coaches, maintenance providers | Gyms, yoga/Pilates studios, martial arts schools, subscription services | Renewals, attendance, reactivation, failed payments, capacity | Entitlements, memberships, billing, classes, pause/cancellation rules |
| Pet services | Dog walkers, pet sitters, independent groomers | Grooming salons, boarding/daycare operators | Intake, recurring visits, reminders, staff handoffs | Animal records, vaccination documents, space/capacity and emergency procedures |
| Rentals and events | Party/equipment rentals, wedding vendors, event planners | Rental fleets, venues, catering/event companies | Availability, quotes, deposits, preparation, returns | Asset availability, turnaround, damage, delivery and event timing |
| Property services | Small property managers, home-watch operators | Property-management and facilities firms | Inquiry routing, maintenance work, vendor bids, updates | Property/unit permissions, emergencies, tenant privacy; no autonomous tenant screening |
| Wholesale and distribution | Niche distributors, local supply businesses | Regional wholesalers and distributors | Reorders, supplier comparison, purchase orders, order status | Customer-specific pricing, terms, warehouse locations, more complex inventory |
| Food and hospitality | Bakeries, food trucks, small caterers, cafes | Restaurant groups, caterers, small hospitality operators | Inquiries, event orders, marketing, purchasing, task coordination | POS, perishable stock, recipes and kitchen operations need specialist work |
| Regulated professional services | Bookkeepers, tax preparers, law offices, insurance/real-estate practices | Accounting, legal, brokerage and advisory firms | Administrative intake, document collection, reminders, status, billing | Appropriate access, review, and sector requirements; professional advice stays with qualified people |
| Health and veterinary practices | Small therapy, dental, allied-health or veterinary practices | Clinics and multi-location practices | Administrative scheduling, forms, reminders, routine office operations | Additional privacy and specialist-system work; no diagnosis, treatment, clinical triage, or care decisions |

For a solo owner, prioritize interruption reduction, follow-up, approvals, and one useful daily summary. For a small team, add ownership, shared conversations, checklists, and purchasing controls. For a mid-sized operation, add departments/locations, role-based visibility, delegated approvals, reporting, and higher-volume integration/recovery support. Those larger-organization features are a proposed extension, not a present enterprise-readiness claim.

Businesses with very little repeatable work or no reliable digital records may have limited benefit until basic information capture is in place. Industry selection alone does not reveal the operating model.

## Example packages an agency could configure

These are proposed combinations of the same product, not new applications or prefilled fictional businesses.

| Real client description | Initial business outcomes | Later additions |
| --- | --- | --- |
| Personal trainer with individual sessions | Capture consultations, fill available sessions, collect intake, remind clients, follow up on lapsed bookings | Packages, group capacity, renewals, approved promotions |
| Salon with several stylists | Book the appropriate stylist, fill cancellations, encourage rebooking, replenish consumables | Staff/resource capacity, deposits, product sales and location reporting |
| Golf shop or reseller | Find buying opportunities, compare economics, approve purchases, receive stock, prepare listings, answer buyer questions | Supported marketplace publication, inventory allocation, shipping and return workflows |
| Local service contractor | Capture scope, follow up on estimates, prepare materials purchases, coordinate jobs, collect payment | Recurring service, dispatch integration, technician/resource planning |
| Professional-service firm | Qualify inquiries, arrange consultations, collect documents, track milestones, send permitted status updates | Retainers, renewals, role-specific reporting and knowledge retrieval |

The partner form should ask what is sold, how work is delivered, the main bottleneck, the systems already used, who does the work, and which actions require approval. From those answers, recommend a small set of outcomes and a concrete connection checklist. Reuse each connection across capabilities and require a successful test before showing a capability as active.

## Connections and boundaries

Calendar, inbox/messaging, website/social, CRM, POS/commerce, inventory, supplier, accounting, document, and staff systems are potential connection categories. A business needs only the connections required by its enabled capabilities.

External APIs constrain what can be done. For example, [Google Calendar event creation](https://developers.google.com/workspace/calendar/api/guides/create-events) requires appropriate authorization and calendar write access. [Shopify inventory updates](https://shopify.dev/docs/api/admin-graphql/latest/mutations/inventorySetQuantities) require inventory permissions and explicitly distinguish the inventory source of truth and concurrent updates. These examples establish design constraints; they do not establish that a Shopify connector exists in this repository.

Routine, reversible work may run within configured rules. Spending, new public claims, unusual discounts, sensitive changes, and material commitments require the corresponding authority or owner decision. The long-term product can support both “ask every time” and carefully bounded automatic actions; the current new business recipes do not execute external purchases or publications.

The intended product does not perform physical work, replace professional judgment, guarantee business results, or operate applications without supported access. Limits should appear beside each capability during setup. An unavailable operation should produce a useful handoff, not a success label.

## Implementation evidence

The current-state descriptions were checked against [capability definitions](../lib/packages/capabilities.ts), [workflow handlers](../lib/workflows/handlers.ts), [CRM intelligence](../lib/crm/intelligence.ts), [CRM actions](../app/crm/actions.ts), [website chat](../lib/chat/assistant.ts), [voice tools](../lib/voice/tools.ts), [outbound voice](../lib/voice/outbound.ts), [booking execution](../lib/scheduling/book-approved.ts), [native CRM lifecycle events](../supabase/migrations/20260904180000_crm_lifecycle_automation.sql), [business recipes](../lib/business/catalog.ts), [business execution](../lib/business/engine.ts), and [prototype handoff](36-business-workspace-prototype.md).

This document changes product documentation only. It does not activate providers, alter business data, deploy features, or certify live readiness. The fixed-rate quote estimator and lifecycle reminders are identified more precisely here than in earlier conversational inventories.
