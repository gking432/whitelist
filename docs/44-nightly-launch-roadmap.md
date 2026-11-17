# Roadmap to the complete business operating app

Updated November 5, 2026 after correcting the earlier roadmap. This is the product build order for the existing application. Hosting, database recovery and Google setup are one foundation task. They are not the full product roadmap.

**November 16 execution correction:** use the [parallel development brief](45-parallel-build-brief.md) to build the product and [build progress](46-build-progress.md) to resume it. Hosted account access is a live verification/release gate, not a global prerequisite for source development. A coordinator and bounded workers should implement shared context, enforced owner authority, manager controls, onboarding, observation and the remaining workflows while blocked account checks stay explicitly pending.

## The finished product

An owner signs up, describes their business and connects the applications they already use. The product prepares a business-context draft and recommends relevant workflows and agent responsibilities. The owner reviews the setup and chooses what can run, what needs approval and what stays off.

The owner sees one calm workspace: what matters today, conversations, work to finish, money due, progress toward goals and decisions requiring them. They can ask the business manager questions or change instructions in chat. Agents and ordinary automations share the same internal customer and business records, coordinate work across connected applications, wait for human decisions when required, perform supported actions and verify the results.

Over time, the system learns from connected activity and the owner's explanations, identifies the actual handoffs behind a workflow and proposes ways to remove work. Improvements are measured against evidence. The owner does not have to maintain or even open the CRM. The phone experience is simple; desktop provides more detail. Both use the same operating system and records.

The initial packaged version serves owner-operated appointment businesses. The architecture supports additional business playbooks and specialist modules over time. Custom enterprise implementation and eventual white-label distribution remain separate expansion tracks; completing the app does not require rebuilding those companies' software or the partner/platform CRMs.

## What already exists

Reuse the existing app, not a new project:

- Responsive Today, Messages, To-do and Manager screens, with an optional detailed CRM.
- Shared customer/business records, durable agent assignments, role definitions, delegation, approvals and action queues.
- Existing website, email, SMS, Instagram and scheduling paths, plus connector adapters with different levels of implementation.
- A new read-only Google connection/import path with account-scoped email/calendar views and connection controls.

These pieces have substantial local verification, but they do not establish a complete live product. On November 5 the hosted database was unavailable; real Google authorization and continuous hosted sync remained unverified. The most recent local connected-data verification passed 324 unit tests, a production build and a database journey with mocked Google responses. There are no iOS or Android application projects yet.

Use [Connected data](43-connected-data.md) and [Shared customer team](39-shared-customer-team.md) for the actual implementation evidence and limits. A feature is not complete merely because a role, prompt, adapter or screen exists.

## Ordered product tasks

These are meaningful product work packages. Each can contain several nightly builds. We select a working increment from the active package each night, with an observable completion check; we do not count every configuration screen as a separate product task or promise the whole app in eighteen nights.

| Task | Complete capability | Completion check |
| --- | --- | --- |
| 1 | **Get the existing platform live with Google.** Restore database access, preserve the source and data, apply reviewed migrations, establish a stable app URL, configure Google authorization and unattended sync, and verify recovery. | You connect Gmail/Calendar inside the hosted app, see your real data from another machine and phone, and receive updates while the browser is closed. Pause/reconnect and edits/deletions work. This incorporates the previous roadmap's small Google/setup steps. |
| 2 | **Build the reusable connection system.** Give email, messaging, calendar/booking, payments/invoices, social accounts, website forms, external CRM, tasks/files and relevant commerce/accounting data the same authorization, import, event, action and health contracts. Prioritize actual pilot applications. | A supported provider can be connected and recovered through the owner flow; data keeps updating; supported reads and writes are explicit. At least one supported flow per selected initial category is proved. New providers reuse the framework. Unsupported applications have a visible implementation/request path, not a fake Connected state. |
| 3 | **Complete the shared internal business system.** Join customers, leads, conversations, appointments, jobs, tasks, estimates/invoices, payments, campaigns and agent work, retaining source IDs and provenance. | Every participating agent sees the same authorized facts and history. Duplicate and conflicting identities are handled explicitly. An external authoritative record is not silently overwritten; the owner can inspect the records without being required to manage them. |
| 4 | **Make business onboarding and context work.** Business description → suggested connections → reviewed context draft → recommended agent/workflow setup. Include services, prices, hours, policies, goals, tone and permissions. | A new real owner reaches a useful configured workspace without code or a sample business. Imported facts are distinguishable from assumptions. The business can start observing or drafting before external-action authority is granted, and context evolves through reviewed updates. |
| 5 | **Finish the single-pane owner workspace.** A brief daily overview, unified conversations, to-do, calendar, money due, goals and an activity/decision history. Keep source links and optional detail. | The owner can work out what needs attention and what to do next from one screen. Empty sections disappear; errors/stale data are honest. Phone and desktop show the same facts at appropriate levels of detail. News or recommendations appear only when relevant and useful. |
| 6 | **Complete coordinated background execution.** Reuse the persistent team to assign work, delegate to specialists, share context, wait, resume, retry safely and track completion. Use deterministic automation where sufficient. | A manager-to-specialist job progresses across multiple tools and a worker restart, without losing its place, duplicating an action or relying on an open chat/browser. Each job has ownership, state, evidence, deadlines, cancellation and sensible usage limits. |
| 7 | **Finish approvals and reliable external actions.** One decision inbox for proposed replies, bookings, campaigns and other supported changes, backed by enforceable permissions and current source state. | Approve, edit, reject, expire and take-over paths work. After approval, the system rechecks the action, executes it once and records a provider receipt or an explicit uncertain/failure state. A draft, a click on Approve and a confirmed external action remain different states. |
| 8 | **Make the business manager a useful control center.** Chat over the shared business context, department work, owner goals and actual outcomes; delegate supported requests and persist changed instructions. | “What needs me?”, “Follow up on these leads” and “Stop using Instagram” produce accurate answers or enforced saved changes. A stop cancels relevant queued work as well as future work. The manager reports what it can and cannot do instead of claiming unsupported actions succeeded. |
| 9 | **Complete the customer-facing conversation team.** Shared inquiry, sales and customer-care responsibilities across website chat, email, SMS and supported social messaging. Preserve each channel's conversation and identity protections. | A real inquiry can use authorized business/customer context, capture missing details, answer supported questions, route to scheduling/service and return a result without making the customer restart. Human takeover, opt-out, escalation and channel rules work. Separate channel adapters do not require unrelated agent personalities. |
| 10 | **Make sales and scheduling finish the job.** Intake → qualified lead → appropriate follow-up/estimate → real availability → approved booking → confirmation → reminder → rescheduling/cancellation → rebooking/review where appropriate. | A real customer's journey reaches an actual confirmed result. The shared record progresses and follow-ups stop or change when the customer responds, books, declines or pays. Exceptions and changed availability come back to the owner. Reuse existing booking/handoff code and close its live-provider gaps. |
| 11 | **Build marketing and lead generation.** Identify usable capacity or demand opportunities; research eligible prospects from supported sources when relevant; prepare audiences, content, campaigns and outreach; execute approved supported publication/sending and track responses. | An owner can approve a concrete campaign or outreach batch and see what was actually published/sent, its cost and resulting inquiries. Research retains source/freshness information; suppression, opt-outs, platform rules and sending limits are enforced. Cold calling, research or outreach is recommended only when it fits that business, not enabled for everybody. |
| 12 | **Complete money, service delivery and routine administration.** Track estimates, invoices, payments, overdue follow-up and job/service tasks; create checklists, handle documents, route exceptions and keep work moving. | A completed appointment/job produces the correct next business work; a paid invoice stops its reminder; an incomplete service task stays visible and owned. Supported business actions use connected systems and approvals. This does not claim to replace accounting, payroll or an ERP. |
| 13 | **Build the workflow observation and improvement system.** Combine an initial context draft, connected events, timestamps, owner explanations and feedback into evolving workflow maps and suggested changes. | The app can show the observed steps/handoffs, evidence and blind spots, then propose a specific reduction in work and let the owner approve it. It can distinguish a stated seven-step workflow from additional evidenced steps. It does not pretend app events reveal every manual action; extra observation needs an explicit supported, permissioned method. |
| 14 | **Measure outcomes and steer toward goals.** Track response time, lead/booking progression, missed follow-ups, owner decisions, failures, revenue where attributable and observed workflow changes. | The owner can compare a recorded baseline with actual results and see useful next actions for their goals. Time saved and revenue impact disclose their basis; the app does not invent savings or equate every AI action with business value. |
| 15 | **Package repeatable business playbooks.** Turn the proven work into configurable setups for selected business types: trainers/coaches, tutors/consultants, independent beauty providers and other relevant appointment/service operators. | Selecting a business type suggests a small useful team and connection/rule checklist. A second business can activate the same proven workflow with its own facts and authority, without bespoke programming. Modules reflect actual business needs, not employee count alone. |
| 16 | **Deliver the web, iPhone and Android experience.** Keep one backend and shared work; provide native sign-in/authorization return, manager access, approvals, deep links and reliable device handling. | Real-device web, TestFlight and Android test builds complete the same owner journey. Push is reserved for genuine owner decisions/actions, not routine activity noise. The simple phone experience does not require CRM navigation; store requirements are addressed before submission. |
| 17 | **Finish production and commercial operation.** Verify security, tenant isolation, privacy/data controls, provider approvals, monitoring, backups/restore, rate/usage limits, operational support and the chosen customer-access/billing arrangement. | The supported product can be operated and recovered safely for multiple businesses. Onboarding, offboarding and any charging/cancellation work as described. Readiness is assessed against the services actually used. Security, failure handling and provider-review work run throughout earlier tasks; this is their final release gate. |
| 18 | **Prove the complete product with real businesses and launch it.** Run the packaged journey through actual business days, fix observed failures and release the verified supported scope on web and approved mobile stores. | Owners connect their own accounts, use the single pane, direct the manager, approve work, receive confirmed outcomes and see evidence-backed improvements without routine developer intervention. Record repeatability, support burden and costs. Store submissions and local tests alone do not count as launch. |

## The dependency order

Run task 1 as the hosted/live-validation track while independent implementation proceeds. Do not wait for Google consent or the hosted database to implement and contract-test the other work. Tasks 2–5 create the connected operating context and owner surface; tasks 6–8 provide reliable coordinated work and control; tasks 9–12 deliver the business jobs; tasks 13–15 make the product adaptive and repeatable; tasks 16–18 finish distribution and release. The coordinator in document 45 resolves actual code dependencies and integrates parallel work. Required real database/provider checks must pass before the affected capability is accepted for production.

This is not a requirement to build every conceivable connector before using the agents. Prove an inquiry-to-approved-booking journey with the first supported stack as soon as its dependencies work, then extend each category through the same contracts. Begin observation and outcome measurement during those trials so improvement claims have a baseline. Exercise the phone experience throughout; native packaging does not require waiting for every optional module.

Hosting, security, provider reviews and recovery work continue alongside features. External approval delays can overlap independent work. An owner's first useful live workflow can be available well before all eighteen work packages are complete.

## Specialist modules and later expansion

The complete core supports adding modules; it does not turn every business into a purchaser, reseller or call center.

- **Retail/reselling:** inventory, market-value research, listing/fulfillment work and margin-backed sourcing proposals, using explicitly supported marketplaces and retained evidence.
- **Purchasing:** supplier comparison, approved purchase requests, order/receipt tracking and exceptions for businesses that need them. Do not enable spending or negotiation through a prompt alone.
- **Voice:** optional inbound answering, routing and supported booking/customer handoffs.
- **Additional programs:** extra booking, CRM, accounting, social, commerce and task systems through the shared connector contracts. API integrations are preferred where suitable; browser/computer operation is a separately permissioned supported implementation, not a promise that logging into any app makes it reliable.

Custom enterprise work adds discovery and bespoke workflows inside a client's existing programs, potentially with a department-specific single pane. White-label rights, partner packaging and partner/platform CRMs follow the proven product; they are not prerequisites for its core operation. The broader [business capability inventory](37-business-capabilities-and-business-types.md) remains the extension catalog.

## Nightly execution

Each night choose an increment that produces a working capability, not just another mock screen. Record the business outcome, code/configuration changes, verification and the next unfinished increment. Infrastructure/access steps are substeps of task 1, not separate roadmap milestones.

Examples of appropriately scoped nightly increments after access is available:

- A real Google connection keeps the owner's email and schedule updated in the hosted app while the browser is closed.
- A real customer inquiry becomes a scheduling assignment and a phone approval, followed by one confirmed calendar event and customer confirmation.
- The manager's saved “stop Instagram” instruction blocks new work and cancels the relevant unsent work, with proof visible to the owner.
- An approved follow-up is sent once and is automatically suppressed if the lead has already booked or opted out.
- The observer shows one evidenced workflow and a measurable proposed improvement instead of an unsupported general recommendation.

Some of these increments require multiple sessions. Split them when needed without relabeling every small setup step as another completed product capability.

## Current implementation and live gates

| Work package | Status | Next evidence needed |
| --- | --- | --- |
| 1 | Partly implemented; live hosting blocked at the November 5 check | Restore existing database access, then finish the secure Google authorization and unattended hosted-data journey. |
| 2–12 | Mixed existing implementation and unfinished product work | Audit the existing paths against the completion checks; reuse them and close the missing connections, tools, permissions and live execution. |
| 13–15 | Full product behavior not verified | Implement evidenced observation, measured improvements and repeatable activation, extending existing context/catalog/reporting pieces. |
| 16 | Responsive web exists; native applications unfinished | Prove native authorization, approvals, notification/deep links and distribution on real iOS/Android devices. |
| 17–18 | Not complete | Operational/provider readiness and evidence from real customer use. |

The account-side requirements for the live-validation track remain [Supabase project access](https://supabase.com/dashboard/project/memyvqqlosoeqnpgxfvq) and Google Cloud OAuth configuration. They do not define the scope of the finished app. Do not request model credentials or activate customer-facing agents merely to prove the read-only connection.

## Supporting references

- [Connected-data implementation and setup](43-connected-data.md)
- [Existing customer team and execution evidence](39-shared-customer-team.md)
- [Connection/activation implementation](40-agent-connection-activation.md)
- [Business capability extension catalog](37-business-capabilities-and-business-types.md)
- [Google restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Play account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
