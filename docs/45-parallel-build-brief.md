# Parallel development brief for the complete application

Updated November 16, 2026. This is an executable handoff for a new coding chat in this repository. The user explicitly wants coordinated development agents to build the full product, without stopping all engineering for account setup. Follow the product outcomes in [the full roadmap](44-nightly-launch-roadmap.md); use the dependency and execution rules here when they differ from its earlier serial ordering.

## Launch instruction

Act as the engineering lead and integration owner for `/Users/gkn/partner-platform`. Implement the complete product described below by delegating bounded coding tasks to available subagents, integrating their changes, testing the combined application and continuing through the remaining feasible work. Start implementing during this session after a short repository audit. A plan, another roadmap, static screens or worker summaries do not satisfy the assignment.

Use the available parallel-agent tools when this session exposes them. Respect actual concurrency limits. With four total slots, run yourself plus at most three workers. If delegation is unavailable, say so briefly and implement the same bounded tasks sequentially; never pretend background agents exist.

The end goal is a production-capable web, iPhone and Android business operating app. Complete as much actual engineering as the available session allows, checkpoint precisely, and resume remaining work from the progress file in later sessions. A prompt cannot create unlimited runtime or bypass provider/account access. Do not claim continued background execution after a session stops unless a real running process or authorized scheduled task exists.

## Product contract

The product is **a single pane agentic operating solution** for an owner-operated business, initially appointment/service businesses:

1. The owner describes the business and connects relevant applications through the app.
2. The system assembles a source-backed business-context draft; the owner reviews facts, unknowns, policies and authority.
3. It recommends useful workflows and agent responsibilities. Observing, drafting and external actions have distinct permissions; agents are not silently activated by importing an account.
4. The owner sees a minimal daily overview, important conversations, tasks, appointments, money due, goals and decisions. Empty sections are absent; stale data and incomplete coverage are explicit. The CRM is optional detail.
5. A business manager accepts requests and persists changes such as “stop using Instagram.” Managers/specialists share the same authorized records and durable assignments, use connected tools, coordinate handoffs, wait for approvals and verify external results.
6. Customer inquiry/care, lead follow-up, bookings/reminders/rebooking, marketing/lead generation, money follow-up and routine operations deliver actual supported business outcomes. Channel adapters share the customer team; do not create unrelated personalities for every message channel.
7. Observation uses connected events plus owner explanations to expose handoffs, delays and missing steps, suggest a concrete improvement and measure it. Current-state snapshots alone are not a complete historical process log.
8. Phone keeps oversight, manager chat, source-app links and human decisions simple. Desktop provides more detail. Native iOS/Android apps share the same backend and state.

Retail inventory, reseller sourcing/purchasing and voice are optional modules for businesses that need them. Custom enterprise discovery/implementation and white-label commercialization are later expansion tracks. New partner/platform-owner CRMs, universal marketplace coverage and a replacement accounting system are not requirements for this core build.

## Read and preserve before editing

Read `AGENTS.md`, applicable skills, `docs/00-start-here.md`, `docs/44-nightly-launch-roadmap.md`, this brief and `docs/46-build-progress.md`. Consult implementation evidence in documents 39–43 and the relevant source; historical documents do not prove current live readiness. Follow the installed Next.js guides under `node_modules/next/dist/docs/` before changing framework code.

Inventory the current working tree, including untracked files. There is substantial existing uncommitted product code. Do not reset, clean, discard or silently replace it. The current working tree—not just Git HEAD—is the implementation baseline. Inspect environment variable presence without printing secrets. Use current official documentation for APIs/libraries you actually change.

The user removed the local Docker/Colima environment to recover about 21 GB. Do not recreate that VM, start `npm run prototype`, run a database reset or seed a fictional business. Preserve the application and migration files. Do not touch `/Users/gkn/new` or the separate golf shop project. Check disk before dependency/toolchain work; reuse available tooling and avoid duplicating dependency folders/build caches per worker.

Useful existing code:

- `lib/agents`, `lib/conversations`, `lib/jobs`, `lib/delivery`: persistent coordinator, specialists, handoff, approvals and execution. Extend these instead of adding a rival runtime.
- `lib/business`, `lib/crm`: business/customer records, daily brief, profiles and existing operations.
- `lib/connections`, `lib/integrations/connectors`, provider adapters: authorization, normalized imported data, scoped reads, sync and guarded actions.
- `components/business`, `components/conversations`, `app/client`: existing owner experience. Preserve the accepted minimal layout.
- `supabase/migrations`, `tests`, `scripts/verify-*.ts`: persistence, permission boundaries and verification. Read scripts before running; several create database fixtures or require infrastructure.

The existing model implementation uses Anthropic in places; the user requested avoiding Claude. Honor that preference when implementing AI, follow the current credential/migration skills, and preserve behavior through provider-contract tests. Missing model credentials block real model evaluation, not pure policy, context, queue, UI or contract work.

## Keep external access off the global critical path

The November 16 hosted health check returned 503 with an unavailable database. Google OAuth credentials were last verified missing on November 3; safely recheck relevant configuration once rather than treating that dated result as permanent. Local database-backed tests are not currently available through the deleted VM.

Record each actual access problem once in the blocker register, with its affected acceptance check and exact owner action. Then continue all independent engineering. Do not end the entire build with “sign into Supabase” or “connect Google” while feasible product work remains.

Build production code behind real authenticated/scoped APIs, pure domain logic, migrations and testable repositories. Use injected repositories, clocks, provider responses and model decisions in tests. Label that evidence accurately. Do not create a fake data path in the product, bypass auth, hardcode test tenants, or make a mocked integration look connected.

Database tests must eventually use actual Postgres/Supabase semantics in an authorized isolated environment; in-memory tests do not establish RLS, transactions or migration correctness. If no such environment is available, keep those checks pending. Do not write test fixtures into the hosted business database as a substitute. Provider consent, real inbox/calendar accuracy, delivery receipts, store enrollment/signing and reviews also remain real release gates. Workers can prepare implementation and verification procedures before those gates open.

## Source checkpoints and GitHub

November 17 owner instruction: commit and push the implementation as development progresses. After each coherent tested wave, review the actual tracked and untracked source changes, exclude credentials/local settings/generated artifacts, commit a clear checkpoint and push it to the current authorized project branch. Verify the remote commit and report its GitHub link. The configured repository is `gking432/whitelist`; use the verified existing remote rather than inventing another destination.

Inspect/fetch the branch before pushing and preserve concurrent work. Do not force-push, reset user work, commit secrets, merge into main or treat a source push as migration execution/production acceptance. Use the normal permission mechanism for Git/network operations when needed. Record any actual push failure precisely, preserve the local commit and continue unaffected authorized work. Routine commit/push is already requested; do not repeatedly ask the owner whether to save completed work.

## Parallel team and ownership

You are the coordinator and integrator. Define shared interfaces before dependent edits. Give each worker a bounded result, exclusive file ownership, required behavioral tests and remaining integration gates. Ask workers to return implemented changes and evidence, not a generic design document. Review their actual diff before accepting a result.

Prefer isolated Git worktrees from a reviewed, secret-free source checkpoint that includes the current implementation. A fresh checkout of the old HEAD will omit untracked features. If checkpoint/worktree creation is unavailable, use explicit disjoint ownership in the shared working tree and serialize overlapping edits; never lose existing work to manufacture a clean baseline.

| Role | Ownership | First responsibilities |
| --- | --- | --- |
| Coordinator | Shared types/contracts, migrations, API boundaries, cross-layer integration, project/dependency configuration, progress records and release gates | Define context/policy contracts, integrate worker changes, exercise full flows, review security/cancellation behavior and keep work moving. |
| Worker A — execution and control | Assigned files in `lib/agents`, `lib/conversations`, `lib/jobs` and their tests | Centralize and enforce owner authority, channel pause/stop and stale-action checks using the existing durable work system. |
| Worker B — business evidence and observation | Assigned context/evidence modules in `lib/business`, relevant `lib/connections` mapping modules and their tests | Give manager and dashboard the same bounded source-backed context; expose freshness/coverage; build evidenced workflow observations. |
| Worker C — owner experience | Assigned existing/new components under `components/business` and selected `app/client` routes, plus presentation tests | Reviewed business context, authority selection, manager/approval visibility and phone/desktop consistency using the agreed server contracts. |

These are development agents building the app; they are not the customer-facing manager/specialists being implemented. Reassign freed slots to independent review, mobile or connector work as the backlog changes. Do not exceed available slots. Workers request changes to shared types, migrations, API schemas and package files through the coordinator. Do not let multiple workers edit a runner, shared schema or migration history simultaneously.

## First integrated engineering wave

Deliver **reviewed business context and enforceable owner authority**, using the existing owner surfaces and execution system. This meaningfully connects onboarding, the manager and real action boundaries and can be implemented without Google consent.

Before spawning implementation workers, agree on a versioned server contract carrying:

- The existing business profile and proposed context fields, each with source record identity, timestamps, reviewed state and explicit unknown/conflict/completeness information.
- Supported connected capabilities and per-stream freshness/coverage, without raw payloads or secrets.
- Recommended responsibilities/workflows with reasons and prerequisites, not an arbitrary full team for every business.
- The effective authority for each supported account/channel/capability and a revision checked by commands and execution. Choose a small clear set of modes such as off, observe, draft and require approval; map them to existing settings rather than introducing a competing policy system.
- Revision-checked review/change commands and a record of what actually changed. Unsupported requests cannot be acknowledged as completed changes.

Worker A: first add executable reproductions and fix the existing action drainer's due-job selection, outcome accounting and lost-completion-claim handling. `lib/jobs/runner.ts` currently limits its candidate batch before excluding retries still in backoff and counts outcomes other than failed/uncertain as successes; `lib/jobs/dispatch.ts` does not verify that its claim-bound final update changed a row. Preserve its compare-and-swap/uncertain-write protections and prove the corrections through an injected store/executor/clock. Then implement a central effective-policy evaluator, integrate it at work creation and immediately before side effects, and support persistent owner stop/pause through the manager command path. Reuse existing settings, work controls and delivery guards. Verify that stopping a channel suppresses future work and cancels relevant unsent work; approved-but-unsent actions must recheck current policy. Already completed or uncertain provider actions are reported accurately and never “undone” by changing a flag. Provider-level read-only mode must not be escalated by a manager request. Manager control commands must remain operable when the team is paused: the current request queue and composer require an active team, so queuing a resume instruction in that paused queue would deadlock. Execute validated controls through the authorized mutation path with durable command/result history, idempotency and stale-revision protection; ambiguous requests make no change. Reuse existing global/department settings and activation channel choices. Distinguish paused external work from collecting inbound records.

Worker B: create a shared evidence/context builder and loader adapters. The daily brief currently joins business records and imported Google data, while the manager independently samples records and loses useful source identity. Unify these facts with record IDs/revisions, provenance, timestamps, tenant scope and bounded-query coverage. Retain contact identity protections and native/imported event deduplication. Extend existing canonical read models rather than creating a second CRM or pretending overwritten snapshots form an event history.

Worker C: extend the existing setup/activation surfaces with reviewed context and authority selection. The current description/profile, recipe recommendations, read-only Apps screen and assistant activation are disconnected steps. Keep the minimal presentation; expose unknowns and connection prerequisites honestly, preserve draft progress and provide actionable failures. Suggested exclusive files are `components/business/setup.tsx`, `components/business/activation-setup.tsx`, `components/agents/manager-chat.tsx`, new context-review/onboarding-progress components and a scoped onboarding route; finalize the boundary with the coordinator before editing. The manager must expose supported control commands even while normal assignment creation is paused; preserve truthful action/delivery states.

Coordinator: implement/review persistence and authenticated API commands, integrate the three workers, add meaningful cross-layer tests and verify the combined behavior. No visible Save/Stop/Approve control may claim success if its production persistence/execution path is missing. If database execution is blocked, ship the code and migrations with the database acceptance explicitly pending rather than replacing persistence with localStorage or a pretend success response.

First-wave acceptance: a business context review is represented and revision checked; the same business facts reach owner and manager; an owner authority change is persisted by the intended production path; work is created/executed according to that authority; tests prove identity/scope, stale revisions, stop and read-only behavior. Report separately which parts have code/contract evidence versus real database/browser proof.

## Subsequent waves toward the whole product

Select tasks by actual dependencies and reuse completed code. Continue after the first wave; do not stop at onboarding or a policy helper.

1. **Observation and traceable work:** build a common event/evidence lineage from imported facts, assignments, approvals, actions and receipts. Start with deterministic waiting-point observations over current records, with an injected clock and source references. Then instrument ongoing events to map actual handoffs and baseline timings. Describe gaps; unread mail alone is not proof of a neglected sales inquiry. Feed findings to manager and minimal owner views.
2. **One complete customer workflow:** finish inquiry → shared lead/customer → real availability → specialist handoff → owner decision → external booking → confirmation → reminder. Then extend cancellation, rescheduling, rebooking/review and eligible follow-up. New messages, owner takeover, opt-out, policy changes or changed availability must stop stale work. Reuse existing implementation and verify it rather than rebuilding the flow.
3. **Core connector breadth and internal work:** implement selected real intake-form and payment/invoice provider flows, show correct source-backed balances/statuses, and link service tasks and eligible reminders. Normalize events/actions through existing contracts. Prioritize one supported application per needed category; no catalog-only claims or universal browser-automation promise.
4. **Marketing and lead acquisition:** supported prospect research with source evidence, segmented campaigns/outreach with owner approval and suppression, actual supported delivery/publication and attributed results. Never silently authorize bulk outreach, spending or account permission escalation.
5. **Repeatable setup and measured outcomes:** package the proven appointment-business playbooks, evolve reviewed context, connect observations to proposed workflow changes and actual goals, and measure baselines/results without inventing saved time or revenue.
6. **Mobile and release:** share the real backend, ship useful iOS/Android owner flows with secure sign-in/authorization return, human-action notifications and precise deep links. Add native work without another web-app rewrite or fake data. Verify operational recovery, tenant boundaries, data controls, provider approvals and commercial access. Complete supervised real-business and store acceptance when access is available.

Run reliability, privacy and authorization work alongside every wave. Read-only data access, model drafting, owner approval, queued delivery and verified external completion are different capabilities and states.

## Verification and reporting contract

Establish a fresh baseline and keep the relevant checks green. Known commands in this repository include:

```sh
npm test
npm run typecheck
npm run build
```

Use targeted behavioral tests during implementation and lint the changed modules. Run the integrated suite/build when a coherent wave is integrated. Some tests bind a loopback socket; an EPERM may be an environment restriction, not a code regression. Use the allowed permission mechanism or record the blocked check; do not weaken or delete the test. The build can require network access for framework assets. Treat all credentials and environment output as confidential.

Read `scripts/verify-*` before running. Database/worker scripts require an appropriate environment and can write fixtures; `npm run prototype` can start the deleted local infrastructure. Do not run them blindly. Never skip auth/RLS/approval checks merely to get a green demo, and never count injected model/provider results as live proof.

Require tests at actual boundaries: business isolation, shared context and provenance, policy version changes, job interruption, duplicate triggers, stale approvals, opt-outs, source updates, cancellation, expired permissions, uncertain writes and receipts. Native builds need their own tests/device evidence; a successful Next build does not prove mobile distribution. Appropriate model quality evaluations need the actual configured provider and a representative business dataset.

For each backlog item, track implementation, unit/contract, database integration, browser/device and live-provider evidence separately. Use `code_checked` when code passes its available checks; use `accepted` only when its defined applicable acceptance checks pass. Missing external evidence must stay visible even if unrelated source work advances. The overall product is not production ready while a required release gate remains open.

Keep the current state in `docs/46-build-progress.md`, including task ID, worker/file ownership, dependencies, changed files, checks/results, actual blocker and exact next action. Update it at wave boundaries and before a session ends. Resume from it instead of repeating the same audit or setup conversation.

If time/context/tool limits end the session, preserve reviewable work and write a precise continuation. Do not claim success because a budget is exhausted, and do not imply agents keep running after they stop. If one external gate blocks a feature, continue other feasible backlog items. Stop the entire implementation only when no meaningful authorized independent work remains, the user stops it, or a real session constraint requires a checkpoint.

Keep user updates concise: completed capability, evidence, next capability, and changed external blockers. Before asking the owner to connect accounts, complete the implementation that makes the test concrete and reviewable. Respect existing authorization; do not repeatedly request permission for routine coding. Never expose secrets, remove existing work, provision unapproved paid resources or bypass necessary provider/store consent.

## Begin now

Inspect the working tree and progress file, establish the contracts for the first integrated wave, assign the bounded workers and edit the actual implementation. Integrate and test it, then continue the feasible backlog. Do not answer this prompt with only another plan or a request to restore Supabase.

The user wants tangible progress toward the whole application. Your job is to coordinate, build, verify, and leave one coherent product.

## Basis for the development workflow

This is our project-specific execution design. It uses bounded delegation, a coordinating integrator, explicit build/test instructions and isolated work where possible, consistent with [OpenAI's Codex best practices](https://learn.chatgpt.com/guides/best-practices). It is not a guarantee that any one prompt/session can complete external consent, production verification or app-store review.
