# Production handoff

The application code is deployable without customer credentials in source.
Production activation is intentionally split into platform setup, partner
setup, and live-account verification.

## Platform owner setup

1. Create the production Supabase project and apply every migration in
   `supabase/migrations` in timestamp order.
2. Deploy `render.yaml`, set `APP_URL` to the public HTTPS app URL,
   and point the web, job, and voice services at that URL.
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
npm run verify:security
npm run verify:restore
npm run desktop:dist:mac
npm run verify:desktop-bundle
```

Then complete one production pilot with real accounts: partner onboarding,
client package installation, Twilio call/SMS, web lead, web chat, forwarded
lead email, calendar availability/booking, CRM write-back, support escalation,
and owner-controlled release approval.

## Desktop distribution

Configure Apple signing/notarization, Windows code signing, and GitHub release
credentials before publishing installers. Follow
`docs/26-desktop-release-and-rollback.md`; an unsigned local DMG proves the
package but is not a production distribution artifact.

## Codex connector worker

The public web service keeps `ENABLE_CODEX_CONNECTOR_WORKER=false`. Connector
requests, sanitized prompts, owner approval, validation, and release tracking
still work while execution is disabled.

To enable code execution, use a dedicated trusted worker host with Codex auth,
a persistent source checkout, and an absolute worktree directory outside that
checkout. Set `CODEX_CONNECTOR_WORKSPACE_PATH`,
`CODEX_CONNECTOR_WORKTREE_ROOT`, and then enable the worker. Each approved task
runs in its assigned `codex/connector-*` branch and isolated Git worktree; it
cannot write into the live application checkout or deploy automatically.

## Credential-dependent evidence

Until real vendor accounts are connected, connectors remain
`contract_verified`. Promote an individual connector to `live_verified` only
after its OAuth/API connection, webhook, read, write, retry, and revocation
checks pass against that vendor.
