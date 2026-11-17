# Desktop Today dashboard

See [Owner work areas](42-owner-work-areas.md) for the shared Today, Messages, To-do, and Manager navigation and current behavior outside the home screen.

## Product direction — October 31, 2026

**A single pane agentic operating solution.**

The packaged application brings a business owner's connected tools, decisions, goals, and daily actions into one operating view. Shared CRM and other business records support the agents in the background; they are optional detail for the owner.

The company's custom enterprise service applies the same approach to a company or division: discover its actual workflows, connect its existing applications, deploy appropriate agents, and build a single operating pane over that work. Custom enterprise implementations do not require rebuilding every client into this packaged app.

Google credential setup is on hold while the desktop experience is developed. Partner CRM, platform-owner CRM, and white-label packaging remain deferred.

## Design reference

Found the user's **Fieldnotes — Account Research** Direct Supply dashboard at:

`/Users/gkn/Documents/ChatGPT/Sales Engine/account-research`

Its morning brief provides a typography and daily-work reference. The owner subsequently clarified that the app must start with a blank canvas: no permanent category cards, zero counters, empty-state explanations, or dashboard furniture. No customer or account data was copied from the reference.

## Implemented in the existing application

Desktop `/client` aligns its content with the left edge of the workspace. The date and quiet Add/Refresh controls sit above a short pale blue greeting banner. The banner contains the time-of-day greeting and a concise daily overview; detailed work appears below it. Manager and To-do links stay quiet, and navigation stays in Menu.

Content appears only when the business has something to show:

- A time-of-day greeting using the signed-in profile and business timezone.
- Messages needing a person, decisions/blocked agents, saved unpaid invoices, remaining confirmed appointments, and due to-dos appear in separate sections below the greeting banner. Empty sections do not render. Each shows up to four rows with a link to the existing work area and a disclosed remaining count.
- Invoices come from existing saved business records. Drafts are labeled Draft; paid, archived, and rejected invoices do not appear in the open-invoice section. This is not evidence of a live accounting/payment connection.
- Appointments show actual business-local times. Cancelled/proposed appointments and already-finished appointments are not described as upcoming confirmed bookings. In-progress appointments are identified.
- Saved measurable goals and source-backed saved industry updates live in collapsed sections that appear only when records exist. Goals retain progress editing and linked next actions.
- Ordinary work and actual agent assignments remain in To-do rather than becoming more home-screen feeds.

When there is no actionable work, the banner shows a quiet message. A connected account can say "All clear for now" scoped to the records available here. An unconnected account says "No updates yet" and offers Connect an app. Source errors or truncated queries prevent an all-clear claim. Empty goals/news sections do not render.

Goals, tasks, and saved updates use the existing `business_records`, mutation API, activity log, permissions, idempotent creation, and revision-checked editing. Tasks can be started and completed. A task's goal must belong to the same business. Completing a task does not automatically claim that a measured sales or appointment goal has advanced.

Existing detailed work areas and the mobile owner view remain available through Menu.

## Business-first scope

The proposed initial category is owner-operated appointment businesses, using an inquiry → booking → payment → follow-up journey to decide what deserves implementation and visibility. This is a starting hypothesis for discussion, not a selected industry in the owner's workspace. No salon, trainer, or golf business is created as sample data.

Add a feature when a real business workflow needs it, an actual connection supplies useful information, or the owner must make a decision. Blank space does not require a feature.

## Data boundaries and limits

| Surface | Actual source | Current limit |
| --- | --- | --- |
| Goals and workspace actions | `business_records` | Most recent 1,000 workspace records |
| Other internal tasks | Open `crm_tasks` | 200 rows; exact open count |
| Upcoming calendar | Booked/proposed `crm_appointments` | 200 rows; filtered by business-local day |
| Customer decisions | Pending `approval_items` | 50 rows; exact pending count |
| Customer attention | `business_conversations` with `needs_attention` state | 50 rows; exact count |
| Agent activity | `agent_work_items` | 30 recent assignments plus up to 30 blocked assignments |
| Industry brief | Saved knowledge records categorized as Industry update | Requires an HTTP(S) source link |

Queries derive partner and client scope from the authenticated portal. Connection secrets and configuration are not sent to the dashboard. Partial data failures show an explicit warning rather than an all-clear claim. Truncation is disclosed in the brief.

## Still separate work

- The dashboard does not activate unconfigured OAuth connections. Google setup remains paused.
- It does not yet automatically fetch industry news, classify arbitrary inbox emails as urgent, or generate a personalized daily plan.
- Progress is manually recorded; provider-verified goal metrics are not implemented.
- New information is loaded on opening the page and with Refresh, and after saving changes. Background live updates are not implemented here.
- Calendar and messages only reflect records actually ingested by configured connectors. An empty unconnected account contains no fabricated emails, appointments, or headlines.
- Workflow observation, improvement recommendations, and measured time savings still need their execution and evidence pipelines.

## Verification

The owner story is: open Today → save a measurable goal → add a due action linked to the goal → start and complete it → edit goal progress → reload and see the saved result.

| Boundary | Evidence |
| --- | --- |
| Browser → existing API → records | Created a temporary goal and linked action through the real dialogs |
| Records → dashboard | Goal appeared at 25%; next action and target date appeared in the appropriate cards |
| Completion | Start → Done removed the completed action from open work; reload retained completion |
| Goal editing | Updating current progress from 1 to 2 against target 4 displayed 50% |
| News | A temporary source-backed update appeared with its original source link |
| Minimal visibility | Browser check added an action to the otherwise blank screen, then completed it; the action section appeared and disappeared with the actual work |
| Isolation/concurrency | Local verification script checks cross-client link rejection, retry deduplication, stale revision rejection, and saved task completion |
| Dates and prioritization | Unit tests cover local midnight, daylight saving, overdue order, rolling seven days, and source filtering |

Temporary browser records and isolated database fixtures are removed after verification. No sample business is added to the owner's account.

Commands:

```sh
npm run typecheck
node --experimental-strip-types --test tests/daily-brief.test.ts tests/business-workspace.test.ts
npx tsx --env-file-if-exists=.env.local scripts/verify-daily-brief.ts
```

The generated migration `20261031155701_desktop_daily_brief` extends the existing record-kind constraint to permit goals. It preserves existing RLS and server-only writes. The local security advisor reported one pre-existing warning about `public.set_updated_at` having a mutable search path; this dashboard adds no SQL functions or policies.

## Hosted preview — October 31, 2026

- Existing Vercel project/team verified: `partner-platform`, `gking432s-projects`.
- Current working-tree source uploaded as preview `dpl_DBW5hnDpmJKLL8gwasd4gMnRcmqs`; build **READY**. This includes the existing backend and four owner work areas. Production was not promoted.
- Preview: https://partner-platform-m4yqmzms7-gking432s-projects.vercel.app/client . Deployment protection is retained; temporary access links are not committed to documentation.
- Browser verified the hosted `/client` entry requires application sign-in. Local-only prototype login stays unavailable against the hosted database.
- **Blocked before authenticated hosted verification:** the existing Supabase project `memyvqqlosoeqnpgxfvq` hostname does not resolve; the pooler reports tenant not found. `/api/health` returns 503 with database unavailable. The management account is not signed in on this machine. The owner was asked to check project status and resume it if paused. No replacement database, reset, or seed was performed.
- After restoration: inspect hosted migration history, review/apply missing migrations, verify the owner's actual workspace access and authenticated Today/Messages/To-do/Manager flows. Provider configuration and background workers still require their own live verification.
- Local verification for this layout: TypeScript, targeted ESLint, eight daily-brief tests, and browser save → brief row → open → start → complete. The brief returned to its empty state and the temporary action/activity rows were removed.
- Screenshot: [Centered daily brief](assets/desktop-daily-focus.jpg).

## Layout revision — November 1, 2026

The owner clarified that the blue box is only the greeting/daily overview. It is now shorter and left-aligned with the workspace, with the greeting inside it. Messages, saved invoices, appointments, decisions, and due work appear separately below it, using existing records and links. Empty categories remain hidden. No sample business or sample work was added.

TypeScript, targeted ESLint, and nine daily-brief tests passed. The section regression check covers messages/invoices remaining visible when urgent work fills the summary, correct invoice Draft/paid treatment, and blocked work routing into To-do.

Fresh visual verification is blocked: the in-app browser times out while opening/reloading preview tabs. Local automatic sign-in also returns to the sign-in screen without establishing a session. The earlier screenshot above records the previous layout and must not be presented as this revision. No authentication controls were changed.

The revised working-tree source was deployed to the existing Vercel project as preview `dpl_DrcxDveDZ3YkNjKhrf3EkhdhYsb2`, build **READY**: https://partner-platform-dbrrm3lk1-gking432s-projects.vercel.app/client . Deployment protection remains enabled; production was not promoted. Temporary preview-access links are not committed.

## Public design preview — November 3, 2026

At the owner's request, the current screens are also available without sign-in at:

https://business-workspace-preview.vercel.app/preview/

This is a read-only design version with no accounts connected and no invented business/customer records. Today, Messages, To-do, Manager, and an explanatory Apps page can be browsed. It reuses the existing presentation components through `/preview` routes and exports their HTML/styles/fonts with `scripts/export-design-preview.mjs`. The public deployment has no application JavaScript, API routes, database credentials, or agent runtime; its only JavaScript updates the greeting/date. Content Security Policy blocks network connections and form submission.

The static preview is hosted in a separate Vercel project `business-workspace-preview` (`prj_JJSuFhkUaKxMBSfhvl6sICcAvqvN`), deployment `dpl_Cqz58okp1cSFS8ds61JzugLvAxH6`, **READY**. That project has no sign-in protection. The actual application project's sign-in and deployment protection were not changed. Local metadata for updating the preview lives in ignored `.vercel/public-preview-project.json`; generated assets are in ignored `out/design-preview`.

Verification: all five public pages returned 200 with zero cookies in anonymous HTTP requests. `/api/business/workspace`, `/api/agents/manager`, and `/client` return 404 on the static preview after normal trailing-slash redirects. The actual local APIs still reject anonymous requests (including `?preview=true`) with 403. Browser navigation through Today → Messages → Manager → Apps passed without sign-in, with manager submission disabled. TypeScript, targeted ESLint, and 13 daily-brief/owner-area tests passed.
