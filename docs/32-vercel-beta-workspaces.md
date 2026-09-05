# Vercel beta workspaces

The opening page offers Platform owner, Partner, and Client workspaces. Signed-in platform users selecting Partner or Client are sent to the owner account directory to choose the target account. Other users are sent to their existing role-protected workspace; selecting a button never grants permissions.

The owner directory groups managed clients beneath their partners, includes account IDs, supports searching by name or ID, and labels test accounts. Live account totals exclude test accounts. Recent unresolved escalations appear on the dashboard. Support tickets have partner/client support-view buttons that return to the ticket when the session ends.

Support views retain the existing one-hour audited session mechanism. Live accounts remain read-only. Full testing is available only for accounts marked as test accounts, with the mode checked again on the server. No tenant-access policies were loosened.

## Data and enrollment

Supabase stores partners with UUID primary keys and clients with their own UUIDs plus a partner_id foreign key. Memberships scope account access. Tickets carry partner/client relationships. IDs are generated when records are created. The owner workflow creates a partner and guides their setup; public paid enrollment still needs hosted billing configuration and verification.

## Hosting

Vercel project: `partner-platform`, team `gking432s-projects`, linked to `gking432/whitelist`. Node 24, Next.js framework. `vercel.json` skips downloading the desktop Electron binary during web installation. Next.js output is standalone for Render/desktop builds and uses Vercel packaging when VERCEL=1. The initial hosted build failed on a missing next-server trace when standalone output was forced; selecting Vercel packaging resolved it.

The existing Git production branch remains `main`; the current beta implementation is on `codex/v1-scenario-lab`. An explicit CLI production deployment can publish this branch without merging. Branch pushes otherwise create previews until the beta is merged or the production branch is intentionally changed.

`.vercelignore` excludes local environment files, desktop artifacts, and local database seed/state. Never upload the localhost Supabase URL or local credentials to the hosted project.

`getAppUrl()` honors an explicit APP_URL and existing Render configuration. On Vercel it falls back to the production domain for production and the deployment domain for previews. Configure Supabase authentication to allow the chosen hosted domain's `/auth/confirm` and `/auth/callback` routes, including their query parameters. Prefer explicit APP_URL for the stable beta domain.

## Hosted database activation

The original development database remains local and unchanged. Hosted activation status:

1. Complete: Marketplace terms accepted; `partner-platform-beta` provisioned on the Free plan, project ref `memyvqqlosoeqnpgxfvq`, connected to Vercel production and preview.
2. Complete: all 84 repository migrations applied, through `20260904200000_embedded_app_connections`. Local `supabase/seed.sql` was not imported. All public tables have row-level security enabled.
3. Complete: hosted Supabase environment and fresh server encryption/cron secrets configured. Production APP_URL is `https://partner-platform-eta.vercel.app`. Private environment files remain ignored under `.vercel/`; `.env.local` still targets development.
4. Complete: `Beta Agency — Test Account` and `Sample Home Services — Test Client` created and explicitly marked as test accounts. The agency also has its automatically created internal business workspace. The sample client uses the CRM experience with fictional contact, lead, and task data and sandbox runtime. Agency onboarding is intentionally unfinished for the guided walkthrough.
5. Complete: owner updated Supabase Authentication URL Configuration. A subsequent generated-link check preserved `https://partner-platform-eta.vercel.app/auth/confirm?next=/control`, verifying that the hosted redirect is accepted.
6. Complete: the chosen owner identity was invited and bootstrapped with an active platform-owner membership. The bootstrap invitation returns to `/auth/confirm`, which handles invite fragment tokens; `/auth/callback` handles code exchange. Inbox receipt, personal sign-in, and hosted escalation/support-session entry and exit remain to be verified by the owner walkthrough.

Production and preview currently share this beta database. Use a separate preview database before onboarding real customers.

The web deployment alone does not activate live telephony or background processing. The repository's voice-stream service, connector worker, and scheduled job runner need deployment and provider credentials as described by the existing release topology. Vercel now has WebSocket support in beta, but connections still end at function-duration limits; the existing standalone voice server is not automatically converted by deploying Next.js. The current Vercel Hobby cron frequency is insufficient for the existing five-minute job runner.

References: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

## Verification

Local checks: TypeScript, ESLint, 279 tests, and production build. Browser walkthrough: three workspace links, owner-to-client selector, sandbox client entry/exit, escalation-to-partner read-only view and return. Hosted verification is recorded separately after deployment; local passing checks do not establish live provider readiness.

## Published web deployment — September 5, 2026

- Public beta entry: https://partner-platform-eta.vercel.app
- Production deployment with hosted database: `dpl_8sCUTD5BXxqGiPkPDGMTd8xsUn78`, source commit `472456a`, status READY. Vercel build completed in approximately 40 seconds.
- Public opening page and enabled sign-in form verified in the browser. Protected workspace entries require sign-in. Hosted redirect configuration passed and the owner invitation API succeeded; inbox receipt and personal sign-in have not yet been observed.
- Hosted API and page tests passed using temporary authenticated owner, partner, and client identities: each workspace loaded, the owner saw the account directory, tenants could not access another tenant or grant themselves owner access, and anonymous account reads were denied. Temporary identities and isolation tenant were removed. The dedicated owner identity was subsequently provisioned after the owner supplied their email.
- Health endpoint returned HTTP 200 with database and schema ready. Production readiness enforcement remains disabled; this result does not certify live providers or workers. Worker release attribution was unavailable on this deployment.
- Owner invitation regression checks passed: six focused bootstrap/session tests, including tenant identity rejection and the fragment-compatible return page.
- Desktop and phone-width local walkthroughs passed, including account search, sandbox client entry/exit, and read-only partner entry from an escalation and return to that escalation.
- Local runtime-dependency audit reported zero vulnerabilities; the cloud installation warnings concerned the broader dependency set including development tooling.
- Original local database preserved. Disposable walkthrough database stopped with its backup retained.

Next: complete owner email sign-in, walk through the hosted agency/client setup and support escalation journey, then configure and test the live provider services and background workers. The database and protected workspaces are available; the application is not yet a fully operational live-services beta.
