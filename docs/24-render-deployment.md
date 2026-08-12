# Production deployment and operations

Northstar uses three Render services:

- `northstar-app`: the web application, APIs, provider webhooks, and health endpoint.
- `northstar-voice-stream`: the always-on WebSocket gateway for staff-assisted calls.
- `northstar-jobs`: a five-minute cron worker for retries and operational retention.

## Prerequisites

1. Create a paid hosted Supabase project and apply every migration in
   `supabase/migrations` in filename order.
2. Create an OpenAI project API key with billing enabled.
3. Create a Render account and connect the GitHub repository.
4. Have one real test account ready for each provider being launched. Code-level
   support does not replace the vendor's application approval or account setup.

## Deploy

1. In Render, create a Blueprint from this repository's `render.yaml`.
2. Enter the requested Supabase and OpenAI values. Generate
   `SECRETS_ENCRYPTION_KEY` locally with `openssl rand -base64 32`.
3. Render automatically wires the app, job runner, and voice-stream service
   URLs from their assigned `RENDER_EXTERNAL_URL` values. No URL copy/paste or
   second deployment is required.
4. Public Next.js variables are
   embedded during the app build, so the app must be rebuilt after they change.
5. Confirm `GET /api/health` returns `200` and `database: "ready"`.
6. Confirm the `northstar-jobs` cron has a successful run in Render.
7. Complete `/partner/onboarding`, create the pilot client, select its package,
   and connect the accounts listed in the client's Setup workspace.
8. Keep every client in sandbox until its Test Center passes. Switch an
   integration to live only after a real inbound and outbound pilot succeeds.
9. In the owner Control Room, open **Provider pilots**, record the required
   real-account evidence, and promote only the provider whose complete pilot
   passed. Connected credentials alone do not make a connector live verified.
10. Run `npm run verify:hosted` with `HOSTED_APP_URL`, `HOSTED_VOICE_URL`, and
    `EXPECTED_RELEASE_SHA` set to prove the public release and voice gateway.

Use paid always-on instances for phone testing. Sleeping services can add enough
cold-start delay for an inbound phone call to fail before the app answers.

## Environment ownership

The platform owner controls Supabase, Render, OpenAI, Resend, release signing,
and the production domain. Each partner connects its own Twilio parent account.
Each client connects its own CRM, calendar, email, retained phone provider,
payments, marketing, reputation, and field-service accounts through scoped setup
links. Credentials are encrypted and never shown again after submission.

The complete variable inventory and optional provider keys live in
`.env.example`. `NEXT_PUBLIC_*` values are public by design; service-role,
encryption, webhook, and provider secrets must never use that prefix.

## Backups and retention

- Use Supabase Pro or higher so production receives daily backups. Enable PITR
  before onboarding paying clients when the recovery window matters.
- Run `npm run verify:restore` against the local Supabase stack before every
  release. It restores the full application schema and data into a disposable
  same-version database, compares every table count plus policies and functions,
  and removes the disposable copy when finished.
- Perform a managed Supabase restore into a separate staging project before
  launch and once per quarter. Confirm owner, partner, and client login after the
  restore; the local drill intentionally copies tenant identities only and does
  not claim to test recovery of passwords, sessions, MFA, or provider-managed
  Auth infrastructure.
- `northstar-jobs` removes expired setup sessions, old rate-limit windows, and
  successful/cancelled sync jobs after `OPERATIONAL_RETENTION_DAYS` (default 90).
- Customer records, audit history, failed jobs, support tickets, and business
  configuration are not removed by the operational cleanup.

## Monitoring

Enable Render deploy-failure, service-health, and cron-failure notifications for
all three services. A failed database check makes `/api/health` return `503` so
Render does not route traffic to an app that cannot safely serve tenants. The
owner Control Center aggregates sanitized server, browser, desktop, voice, and
worker failures under Platform errors. Set `PLATFORM_ALERT_WEBHOOK_URL` to a
private public-HTTPS Slack/incident webhook for first-occurrence alerts. Action
jobs, integration events, sync jobs, support, and audit remain the operational
record for expected provider failures.

## Desktop releases

The GitHub `Desktop release` workflow publishes signed macOS and Windows
installers and update metadata. Before tagging a release:

1. Set both `package.json` and `desktop/package.json` to the same version.
2. Add repository secrets `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `WIN_CSC_LINK`, and
   `WIN_CSC_KEY_PASSWORD`.
3. Push a matching tag such as `v0.2.0`.
4. Install and verify the resulting GitHub Release on one clean Mac and Windows
   machine before sending it to partners.

The app checks GitHub Releases automatically and offers restart-to-install after
an update downloads. The workflow fails instead of publishing unsigned builds.
Run `npm run verify:desktop-bundle` against the distribution artifact and follow
the update/forward-rollback procedure in `docs/26-desktop-release-and-rollback.md`.
