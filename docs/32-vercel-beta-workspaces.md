# Vercel beta workspaces

The opening page offers Platform owner, Partner, and Client workspaces. Signed-in platform users selecting Partner or Client are sent to the owner account directory to choose the target account. Other users are sent to their existing role-protected workspace; selecting a button never grants permissions.

The owner directory groups managed clients beneath their partners, includes account IDs, supports searching by name or ID, and labels test accounts. Live account totals exclude test accounts. Recent unresolved escalations appear on the dashboard. Support tickets have partner/client support-view buttons that return to the ticket when the session ends.

Support views retain the existing one-hour audited session mechanism. Live accounts remain read-only. Full testing is available only for accounts marked as test accounts, with the mode checked again on the server. No tenant-access policies were loosened.

## Data and enrollment

Supabase already stores partners with UUID primary keys and clients with their own UUIDs plus a partner_id foreign key. Memberships scope account access. Tickets carry partner/client relationships. IDs are generated when records are created; adding a public self-service signup/checkout is a separate enrollment feature. The current owner workflow creates a partner and guides their setup.

## Hosting

Vercel project: `partner-platform`, team `gking432s-projects`, linked to `gking432/whitelist`. Node 24, Next.js framework. `vercel.json` skips downloading the desktop Electron binary during web installation. The existing standalone build remains compatible with the Render/desktop release paths.

The existing Git production branch remains `main`; the current beta implementation is on `codex/v1-scenario-lab`. An explicit CLI production deployment can publish this branch without merging. Branch pushes otherwise create previews until the beta is merged or the production branch is intentionally changed.

`.vercelignore` excludes local environment files, desktop artifacts, and local database seed/state. Never upload the localhost Supabase URL or local credentials to the hosted project.

`getAppUrl()` honors an explicit APP_URL and existing Render configuration. On Vercel it falls back to the production domain for production and the deployment domain for previews. Configure Supabase authentication to allow the chosen hosted domain's `/auth/confirm` and `/auth/callback` routes, including their query parameters. Prefer explicit APP_URL for the stable beta domain.

## Hosted database activation

The existing development database is local. Hosted account testing requires:

1. Accept Supabase Marketplace terms in the Vercel account. The CLI explicitly requires this human step before installation.
2. Provision the `partner-platform-beta` Supabase Free resource and connect it to this project. Pull its environment into a separate ignored/private file, never over the local database environment.
3. Apply repository migrations to the newly created hosted database. Do not import `supabase/seed.sql` into the hosted project; it contains local test identities.
4. Set the hosted Supabase URL, public key, server-only service-role key, fresh server-only SECRETS_ENCRYPTION_KEY, and stable APP_URL in Vercel. Check the integration's injected variable names against `lib/env.ts`.
5. Configure Supabase auth URLs and bootstrap the owner's chosen email using the existing owner bootstrap procedure. Create explicitly marked beta partner/client accounts for walkthroughs.
6. Redeploy after setting variables, then verify owner login, account creation, escalation, audited account entry/exit, and tenant isolation against the hosted database.

The web deployment alone does not activate live telephony or background processing. The repository's voice-stream service, connector worker, and scheduled job runner need deployment and provider credentials as described by the existing release topology. Vercel now has WebSocket support in beta, but connections still end at function-duration limits; the existing standalone voice server is not automatically converted by deploying Next.js. The current Vercel Hobby cron frequency is insufficient for the existing five-minute job runner.

References: [Vercel WebSockets](https://vercel.com/docs/functions/websockets), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [system environment variables](https://vercel.com/docs/environment-variables/system-environment-variables).

## Verification

Local checks: TypeScript, ESLint, 279 tests, and production build. Browser walkthrough: three workspace links, owner-to-client selector, sandbox client entry/exit, escalation-to-partner read-only view and return. Hosted verification is recorded separately after deployment; local passing checks do not establish live provider readiness.
