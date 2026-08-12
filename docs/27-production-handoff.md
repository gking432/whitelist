# Production handoff

The application code is deployable without customer credentials in source.
Production activation is intentionally split into platform setup, partner
setup, and live-account verification.

## Platform owner setup

1. Create the production Supabase project and apply every migration in
   `supabase/migrations` in timestamp order.
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
7. Configure `PLATFORM_ALERT_WEBHOOK_URL`, confirm `/api/health`, run the job
   service once, and verify one alert reaches the owner channel.

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
isolated owner, partner, client, and customer fixtures, verifies the complete
package/intake/approval/support path, removes those fixtures, and stops the
server. GitHub CI runs that same journey against a fresh local Supabase stack.
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
