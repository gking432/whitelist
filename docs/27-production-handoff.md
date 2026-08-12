# Production handoff

The application code is deployable without customer credentials in source.
Production activation is intentionally split into platform setup, partner
setup, and live-account verification.

## Platform owner setup

1. Create the production Supabase project. Do not apply schema changes through
   the hosted SQL editor; production migrations are owned by the release
   workflow and tracked in `supabase/migrations`.
2. Deploy `render.yaml`. The Blueprint derives the app, job, and voice service
   URLs from Render automatically.
3. Set the Supabase URL, anonymous key, and service-role key. Generate separate
   random values for `SECRETS_ENCRYPTION_KEY`, `CRON_SECRET`, and
   `VOICE_STREAM_SHARED_SECRET`.
4. Add `OPENAI_API_KEY` for AI answering, live transcription, and the desktop
   scheduling assistant. Add `ANTHROPIC_API_KEY` for AI workflow drafts and
   triage; deterministic fallbacks remain available if it is absent.
5. Configure Resend with a verified sending domain and inbound domain. Set
   `PLATFORM_RESEND_API_KEY`, `PLATFORM_ALERT_FROM_EMAIL`,
   `RESEND_WEBHOOK_SECRET`, and `RESEND_INBOUND_DOMAIN`.
6. Create the platform OAuth applications needed for the launch catalog and
   add their IDs/secrets from `.env.example`. Register callback URLs using the
   production app domain.
7. Configure `PLATFORM_ALERT_WEBHOOK_URL`, confirm `/api/health` reports both
   database and database schema as ready, run the job service once, and verify
   one alert reaches the owner channel.
8. Create a GitHub environment named `production`. Add these environment
   secrets:

   - `SUPABASE_ACCESS_TOKEN`: Supabase personal access token used by the CLI.
   - `SUPABASE_DB_PASSWORD`: production project's database password.
   - `SUPABASE_PROJECT_ID`: reference from the Supabase project URL.
   - `RENDER_APP_DEPLOY_HOOK_URL`: deploy hook from `northstar-app` settings.
   - `RENDER_JOBS_DEPLOY_HOOK_URL`: deploy hook from `northstar-jobs` settings.
   - `RENDER_VOICE_DEPLOY_HOOK_URL`: deploy hook from voice service settings.

   Add `HOSTED_APP_URL` and `HOSTED_VOICE_URL` as environment variables. The
   `production` environment and its `main`-only branch policy are already
   configured; its credential secrets and hosted URL variables are still
   empty. Enable a required reviewer when the repository's GitHub plan supports
   it.
9. Merge the release commit to `main`, open **Actions → Production release →
    Run workflow**, enter the full commit SHA, and type `DEPLOY PRODUCTION`.
    The workflow rejects commits outside `main`, runs quality checks, previews
    and applies Supabase migrations, triggers that exact commit on all three
    Render services, then waits up to 20 minutes for public verification.
10. Run `npm run bootstrap:owner -- --email <owner> --name <name> --app-url
    <production-url> --dry-run`, then repeat without `--dry-run` to send the
    initial platform-owner invite. Never run `supabase/seed.sql` in production.
11. To verify the public services again from a trusted terminal:

   ```bash
   HOSTED_APP_URL=https://app.example.com \
   HOSTED_VOICE_URL=https://voice.example.com \
   EXPECTED_RELEASE_SHA=$(git rev-parse HEAD) \
   npm run verify:hosted
   ```

   This checks database/configuration readiness, the exact app and voice
   commits, security headers, login rendering, job-endpoint authorization, and
   voice health. It does not mutate production data. Confirm the first
   `northstar-jobs` scheduled run in Render because cron jobs have no public
   health endpoint.

Twilio is not a platform-owner account. Each partner connects its own Twilio
parent account during onboarding; the platform provisions isolated client
subaccounts and numbers beneath that partner account.

## Release gates

Run these against the release commit:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:release-journey
npm run verify:release
npm run desktop:dist:mac
npm run verify:desktop-bundle
```

`verify:release` checks the Render topology, database security and restore
drills, and clean builds of all three production Docker images. The web image
is launched on an ephemeral local port and its standalone server is smoke
tested. The jobs image enforces its runtime configuration, while the voice
image must pass its health endpoint and reject an unauthenticated stream. All
temporary verification containers and images are removed after each run.
`verify:release-journey` launches the built production server itself, creates
isolated owner, partner, client, and customer fixtures, and verifies package
installation plus independent form, forwarded-email-envelope, signed Twilio
SMS, website-chat, AI-phone, appointment-request, and authenticated desktop
assistant paths. It also proves CRM creation, idempotency, approval ownership,
external write previews, support routing, and owner read-only impersonation,
then removes every fixture and stops the server. GitHub CI runs that same
journey against a fresh local Supabase stack.
The connector scheduler also
recovers expired read leases within the configured retry limit. An expired
external write is dead-lettered for vendor reconciliation instead of replayed,
because its delivery outcome may be unknown.

Then complete one production pilot with real accounts: partner onboarding,
client package installation, Twilio call/SMS, web lead, web chat, forwarded
lead email, calendar availability/booking, CRM write-back, support escalation,
and owner-controlled release approval.

Record connector evidence in **Control Room → Provider pilots**. The platform
automatically attaches the latest processed inbound and outbound events for the
selected real connection. The owner records provider-read, retry/idempotency,
and credential-revocation evidence; only then can the guarded promotion action
mark that provider `live_verified`. Revocation returns the provider to
`contract_verified` when no other passed pilot remains and preserves the old
pilot as immutable history.

Connector release completion records the externally reviewed version and
enables its optional tenant-scoped feature flag atomically. Rollback disables
that flag, reopens the support request, preserves the reason and audit event,
and exposes a guarded "Prepare revision" path. The platform records deployment
evidence and state; it does not merge or deploy source code automatically.

## Desktop distribution

Configure Apple signing/notarization, Windows code signing, and GitHub release
credentials before publishing installers. Follow
`docs/26-desktop-release-and-rollback.md`; an unsigned local DMG proves the
package but is not a production distribution artifact.

## Codex connector worker

The public web service keeps `ENABLE_CODEX_CONNECTOR_WORKER=false`. Connector
requests, sanitized prompts, owner approval, validation, and release tracking
still work while execution is disabled.

To enable code execution, use a dedicated trusted worker host with Codex auth
and a persistent source checkout. Copy `.env.example` to the host-only
`.env.connector-worker`, set the Supabase service credentials and OpenAI/Codex
credentials, then set `CONNECTOR_WORKSPACE_PATH` to the absolute host checkout.
Start `docker compose -f docker-compose.connector-worker.yml up -d`. The worker
mounts that checkout at `/workspace`, creates isolated worktrees in a separate
volume, renews a durable lease while Codex runs, and safely retries abandoned
work. Each approved task runs in its assigned `codex/connector-*` branch; it
cannot deploy, merge, or push automatically. Never run this worker on the
public application service.

## Credential-dependent evidence

Until real vendor accounts are connected, connectors remain
`contract_verified`. Promote an individual connector to `live_verified` only
after its OAuth/API connection, webhook, read, write, retry, and revocation
checks pass against that vendor.
