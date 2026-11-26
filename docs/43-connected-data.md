# Connected data and the first live account

The next release connects existing application data to the owner's single pane. It does not require an AI provider, agent activation, business knowledge setup, or the custom connector worker.

## Implemented on November 3, 2026

- `/client/apps`: a separate read-only Google connection. Connect opens Google consent in the same browser; callback returns to this screen. Refresh, pause, resume, reconnect, and disconnect are owner-controlled. An existing agent connection is preserved separately.
- `/client/messages`: imported Gmail threads, subject, sender, snippet, unread state, account, and a link to read/reply in Gmail. Initial import covers the last 30 days. It is not yet a full email client: no composer, attachments, HTML body rendering, or mark-read action.
- `/client/calendar`: upcoming primary-calendar events. The first snapshot covers about one month before/after today; a daily fresh snapshot keeps the window moving. Intermediate polls use Google's incremental checkpoints. Additional calendars and dedicated booking providers remain future work.
- Today uses the same responsive single pane on desktop and phone; the older mobile approvals route remains available separately. Active views refresh their cached data while open.
- Today: unread inbox conversations and imported appointments join the existing brief. External event IDs prevent duplicate internal appointments. Imported calendar events retain source links/account and all-day dates. Paused, incomplete, failed, or delayed imports prevent an “all clear” state.
- Imported records stay in the existing canonical integration store. View-only connections do not project CRM objects, enqueue inquiries/leads, run agents, send messages, or change external bookings. Both connection configuration and stored read-only credential mode block Google writes.
- OAuth attempts are signed, PKCE protected, bound to the current browser, signed-in owner and tenant, expiring and single use. Credentials are encrypted server-side. Reconnect must use the same Google account. Display APIs whitelist fields and never return credentials/raw provider payloads.
- `/api/connections/sync`: a separate bearer-authenticated GET/POST scheduler entry point that drains only read-only native pull jobs. It does not run the agent/customer-action scheduler. Imports continue in pages and normally poll every 15 minutes. The existing full `/api/jobs/run` runner can also drain these jobs.

## Current external blockers

1. Hosted Supabase project `memyvqqlosoeqnpgxfvq` is unreachable. Its actual management state is unconfirmed. The account owner must sign into Supabase and check/resume the existing project, or provide authorized management access. Do not reset it, create a replacement, or seed a sample business as a workaround.
2. `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` are absent from both local and hosted preview configuration. They must be created in the owner's Google Cloud project and saved directly as server environment variables, never pasted into chat or browser-exposed variables.
3. Once the database is reachable, apply the reviewed pending migrations, deploy the working app, and configure its data-only scheduler. A static public design preview cannot run OAuth, private account data, or background sync.

## Google setup for the first private test

Use a Google Cloud OAuth client of type Web application. Enable Gmail API and Google Calendar API. Configure the consent screen and add the owner's account as a test user while the app is in testing.

Requested scopes are identity (`openid`, `email`, `profile`), `https://www.googleapis.com/auth/gmail.readonly`, and `https://www.googleapis.com/auth/calendar.events.readonly`. There are no contacts, send, calendar-edit, or calendar-delete grants in this flow.

Register the exact callback for the chosen working app host:

`https://<working-app-host>/api/oauth/google-workspace/callback`

For local verification the callback is `http://localhost:3210/api/oauth/google-workspace/callback`. Set `APP_URL` to the same origin used to open the app and start consent; cookies and callbacks must return to that same origin. Preview deployments otherwise derive their callback from their deployment URL. Do not register the public static design-preview host.

Set the two Google OAuth variables in local `.env.local` and the intended Vercel environment, then redeploy/restart. The owner then selects **Apps & connections → Connect Google**, signs into Google, and approves read access inside the app flow.

Google's public-release verification for Gmail restricted scopes is still a launch requirement. Testing-mode authorizations can have short refresh-token lifetimes. See [Google's web-server OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), and [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth). A successful private account test does not complete Google's production approval.

## Database and deployment

New schema: `20261104025603_readonly_workspace_connections.sql`. It adds a service-only authorization attempt table and atomic complete/manage functions. The schema marker and application expectation match this release. Inspect hosted migration history before applying the October workspace/team/conversation/activation/brief migrations and this migration. Never run a reset against hosted data.

Configure an existing server scheduler to GET/POST `/api/connections/sync` every few minutes with `Authorization: Bearer <CRON_SECRET>`. It must use the private working app host. Vercel Cron needs a production deployment and a plan supporting the chosen frequency; no recurring paid service or new automation was provisioned in this change. Without a running scheduler, callback/manual refresh imports a bounded batch but continuous freshness is not established.

The public design preview remains separate and empty. Do not publish imported mail/calendar records there.

## Verification and acceptance

- `node --experimental-strip-types --test tests/connected-data.test.ts tests/business-activation.test.ts tests/workspace-inbox-adapters.test.ts tests/daily-brief.test.ts tests/owner-areas.test.ts`
- `node_modules/.bin/tsx --env-file-if-exists=.env.local scripts/verify-connected-data.ts`
- Typecheck, targeted lint and production build.

The integration script creates disposable local-only records, uses the real database/native sync runner, mocks external Google responses, verifies edits/deletes/deduplication, tenant isolation, zero CRM/agent side effects, OAuth replay/account binding, pause/disconnect, and removes its fixtures afterward. This is not proof of a live Google grant.

Live acceptance is still required: owner connects Google in the private app; recent real mail and upcoming calendar events appear; change/read/delete an item in Google; verify the next import; pause/resume/reconnect; verify background refresh after closing the browser. No live account has yet completed that acceptance test.

## Next data sources

Payments/invoices, website forms/intake, SMS/social messaging, dedicated booking applications, files and accounting can follow the same scoped read model. This change completes the first Google slice in code; those other sources do not yet have this owner-facing data flow. Native iOS/Android distribution, push notifications and the agentic layer remain separate milestones.

Final verification: 324 unit tests passed; targeted ESLint, TypeScript and the optimized production build passed. The disposable local integration journey passed. A clean migration replay in a shadow database reported no schema differences. Browser roles cannot select the OAuth attempt table or execute its completion function. The security advisor reported only the pre-existing `set_updated_at` search-path warning.

Private preview deployment: https://partner-platform-cym5akhlz-gking432s-projects.vercel.app (`dpl_GHYSHvCwidyQs8pXSGY5SS3FXZdj`, READY). Its `/api/health` still returns 503 because the hosted database is unavailable; the expected schema is `20261104025603_readonly_workspace_connections`. This is a successful code deployment, not a working live-account acceptance test. Production was not promoted. Google credentials remain unconfigured and the dedicated data-only scheduler has not been provisioned.
