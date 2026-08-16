# 13 — Real-World Pilot Test Plan

This is the step-by-step plan for running the **first real lead through
Northstar with real external accounts**. One deliberately small stack:

| Role in the loop | Provider | How it connects |
| --- | --- | --- |
| Incoming leads | Northstar web form / web chat / webhook intake (built in) | Generated endpoint + token |
| CRM | HubSpot (free) | Private app token |
| SMS | Twilio (trial works) | Account SID + auth token + number |
| Scheduling | Google Calendar | OAuth (your own Google Cloud OAuth client) |
| AI | Anthropic | API key (optional — deterministic fallbacks run without it) |

**The loop you will prove:** lead arrives → AI intake routing + reply draft →
HubSpot contact + "AI Assistant" note → human approves the draft → Twilio
sends the SMS → everything visible in Runs/Logs and Audit.

## Honest status — what is real and what is not

Real and testable end-to-end today (see docs/17 for the full matrix):

- Secured inbound intake (webhook/web chat endpoint with token auth,
  idempotency, rate limiting, redacted logs) **plus Twilio inbound SMS**
  (signature-validated webhook → `sms.received` → AI intake routing).
- AI intake routing and reply drafting (Claude when `ANTHROPIC_API_KEY` is
  set; clearly-labeled rule-based fallback when not). New leads get an
  automatic approval-gated first-response draft.
- CRM contact upsert + AI Assistant note into **HubSpot or GoHighLevel**
  (or a signed generic outbound webhook when neither is connected), with a
  **dry-run preview** until the connection is live. Additive-only: never
  deletes, never changes stages, never clears fields.
- Approval-gated **SMS (Twilio) and email (Resend)** delivery. Sending
  happens **only** after a human approves, and **only** in live mode.
  Every other case is recorded honestly as `dry_run` or `skipped`.
- **Appointment booking**: scheduling requests propose real open slots from
  Google Calendar free/busy; approving books the event (live mode only).
- Durable **action jobs with retry** for every send/booking/sync, visible
  on Runs / Logs.
- **Built-in CRM** (contacts, leads, timeline, tasks, appointments) fills
  automatically for clients in primary/mirror/assist CRM mode.

Implemented since this pilot was first written:

- Managed Twilio now supports signed voice webhooks, full-duplex OpenAI
  Realtime answering with barge-in and Gather failover, staff forwarding,
  Media Streams transcription, one-click outbound AI callbacks from CRM
  contacts, playback-aware AI hangup, and desktop assistant events.
- The website chat has a hosted page and iframe embed.
- `render.yaml` provisions the five-minute durable-job worker.

Remaining boundary: appointment reschedule/cancel is manual, and every live
provider still requires its own deployed-account pilot before launch.

---

## 1. Accounts you need

1. **Supabase project** (free) — the database + auth. supabase.com → New
   project. You need: project URL, anon key, service-role key
   (Settings → API).
2. **HubSpot free CRM** — app.hubspot.com, free tier is enough.
3. **Twilio** — twilio.com. A trial account works with two constraints:
   trial numbers can only text **verified** numbers (verify your own cell),
   and messages get a trial prefix.
4. **Google Cloud project** — console.cloud.google.com (free) plus any Google
   account whose calendar will be the client's job calendar.
5. **Resend** (optional, for email delivery) — resend.com free tier;
   verify the client's sending domain for real sends.
6. **Anthropic API key** (optional, recommended) — console.anthropic.com. If
   you skip it, everything still runs; drafts/routing use the labeled
   rule-based fallback.

## 2. Exact API keys / OAuth setup

### HubSpot private app token

1. HubSpot → Settings (gear) → Integrations → **Private Apps** → Create a
   private app.
2. Name: `Northstar Pilot`.
3. Scopes tab → CRM → enable **crm.objects.contacts** Read and Write.
4. Create app → copy the access token (starts `pat-na1-`). This is the only
   value Northstar needs.

### Twilio

1. console.twilio.com → the **Account SID** (`AC…`) and **Auth Token** are on
   the dashboard home.
2. Phone Numbers → Manage → Active numbers: note your Twilio number in
   `+1…` format (trial accounts get one free).
3. Trial only: Phone Numbers → Verified Caller IDs → verify the cell phone
   you will use as the "lead" in the test.

### Google Calendar OAuth client

1. console.cloud.google.com → create project `northstar-pilot`.
2. APIs & Services → Library → enable **Google Calendar API**.
3. APIs & Services → OAuth consent screen → External → fill the minimal
   fields → add the Google account you will connect as a **Test user**.
4. Credentials → Create credentials → **OAuth client ID** → type
   **Web application**.
5. Authorized redirect URI — must be exactly:
   `<your APP_URL>/api/oauth/google/callback`
   e.g. `http://localhost:3000/api/oauth/google/callback` for local runs.
   The Google card on the Setup checklist shows this exact value so you
   can copy it.
6. Copy the **Client ID** (`…apps.googleusercontent.com`) and **Client
   secret** (`GOCSPX-…`).

## 3. Exact environment variables

`.env.local` (see `.env.example`):

```bash
APP_URL=http://localhost:3000                    # or your deployed URL
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>     # server-only
SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32> # server-only, 32 bytes b64
ANTHROPIC_API_KEY=<sk-ant-…>                     # optional
```

Notes:

- `SECRETS_ENCRYPTION_KEY` encrypts every provider credential at rest and
  signs the Google OAuth state. Without it, the setup checklist refuses to
  store credentials (with a clear message).
- HubSpot/Twilio/Google credentials are **not** environment variables — you
  paste them into the client's Setup checklist per client, and they are stored
  encrypted per connection.
- Database: apply all migrations in `supabase/migrations/` (Supabase CLI:
  `npx supabase db push`, or run them in the SQL editor in filename order).
  `supabase/seed.sql` creates the local demo partner/client and logins for
  local development.

## 4. Exact clicks in Northstar

Assume you are signed in as a partner user (locally the dev auto-login signs
you in as `partner@northstar.test`).

### A. Create (or open) the client

1. **Partner → Clients → New client** — create e.g. "Pilot Plumbing Co", or
   open an existing client. New clients land on the **Setup tab**, which is
   a package-driven checklist.

### B. Choose the package you sold

1. **Setup tab → step 1**: pick the package. If you have no packages yet,
   click **Create the three starter packages** (Basic Automation, AI Assist,
   Full AI Operations) — or create a custom package with toggles.
2. For this test plan choose **AI Assist** or **Full AI Operations**.
3. The rest of the checklist appears: only the integrations and workflows
   that package needs, plus what (if anything) client staff must install.

### C. Set up the lead intake

1. Setup checklist → **lead intake step** → the lead-source wizard at the
   bottom of the page → choose the simplest path (website form / webhook).
2. This creates an inbound connection. Open it (Integrations tab) and copy:
   - the endpoint path `/api/integrations/inbound/<connectionId>`
   - the one-time webhook token (shown once — save it now).

### D. Enable the included workflows

1. Setup checklist → **workflows step** → **Enable this package's
   workflows**. Lead Response, AI Intake Routing, and the other included
   packs turn on in their safe default modes.
2. Leave approval requirements at their defaults — customer messages require
   approval.

### E. Connect the required integrations

Still on the **Setup tab** — the checklist shows one card per required
provider. Each card says in plain language what the connection allows and
what it will never do.

1. **HubSpot** — paste the private app token → **Verify & connect**.
   Northstar calls HubSpot with the token before storing it; a typo fails
   immediately with a readable message.
2. **Twilio** — paste Account SID, Auth Token, sending number →
   **Verify & connect**. Same live verification.
3. **Google Calendar** (Full AI Operations package) — paste OAuth Client ID
   + secret → **Save & authorize with Google** → Google consent screen →
   approve. You land back on the Setup page; the card shows a live
   availability check result ("primary calendar has N busy blocks in the
   next 7 days").
4. Every connection starts in **dry run**. Leave them there for the first
   test.

## 5. Exact tests to run

Which events produce what (honest map, matches the current templates):

- `lead.created` / `form.submitted` → AI lead analysis + AI intake routing +
  CRM contact sync. **No SMS draft yet** — the auto first-response draft for
  form leads is a known gap; missed-call rescue is the draft path today.
- `missed_call.created` → everything above **plus** a missed-call rescue SMS
  draft that waits in Approvals. Use this event to test the approval → SMS
  loop.

### Test 1 — dry run end-to-end (nothing real leaves the system)

Send a missed-call lead to the intake endpoint (replace the id, token, and
phone):

```bash
curl -X POST "$APP_URL/api/integrations/inbound/<connectionId>" \
  -H "content-type: application/json" \
  -H "x-webhook-token: <token>" \
  -d '{
    "event_type": "missed_call.created",
    "idempotency_key": "pilot-test-001",
    "data": {
      "name": "Taylor Testlead",
      "email": "taylor.testlead@example.com",
      "phone": "+1<your verified cell>",
      "address": "12 Pilot Ln",
      "message": "Missed call - voicemail: water heater is leaking, can someone come out this week?"
    }
  }'
```

Expect `200` with a processed/run summary. Then verify, in order:

1. **Runs/Logs tab** — a Lead Response run, a Missed-Call Rescue run in
   **Awaiting approval**, and an AI Intake Routing run. Open them: you see
   the analysis/draft/routing steps, whether AI or fallback produced them,
   and a **CRM sync (dry run)** step containing the exact HubSpot payload
   that would have been sent.
2. **Assistant tab** — the console shows the interaction (phone/missed
   call), the AI read (category, urgency, missing fields, next question),
   the waiting SMS draft, CRM dry-run status, and honest action states.
3. **Approvals tab** — a pending customer-message draft with the SMS text
   and destination number.
4. Approve it. The result message should say it was recorded as a **dry
   run** because Twilio is not live. The run summary and the outbound
   `sms.customer_message` event (status `dry_run`) both say the same.
5. Nothing appeared in HubSpot, no SMS arrived — correct, everything was in
   dry run and said so.

### Test 2 — live CRM sync

1. Setup tab → HubSpot card → **Go live**.
2. Re-send the curl with `"idempotency_key": "pilot-test-002"`.
3. Run detail now shows **CRM synced** with the HubSpot contact id, and in
   HubSpot a contact "Taylor Testlead" exists with an
   **"AI Assistant — Northstar"** note. Send it a third time: the contact is
   **updated**, not duplicated. The Assistant tab's **Sync to CRM** button
   does the same push manually.

### Test 3 — live approved SMS

1. Setup tab → Twilio card → **Go live**.
2. Send `"idempotency_key": "pilot-test-003"` (still `missed_call.created`)
   with your verified cell in `data.phone`.
3. Approvals → open the draft → optionally **edit** the message → approve.
   (The Assistant tab's **Review & approve** button jumps straight there.)
4. The result message shows the Twilio message SID; your phone receives the
   SMS. The outbound event is `sent`, and the audit trail shows who approved
   and when.
5. Reject a fourth lead's draft: no SMS, run marked cancelled — the gate is
   real in both directions.

### Test 4 — calendar connection health

1. Setup tab → Google Calendar card → **Test connection**. Expect the
   busy-block count from the real calendar. Add an event in Google Calendar,
   test again, and the count changes.
2. That is the extent of the calendar loop today — see honest status above.

### Test 5 — website chat end-to-end

1. Knowledge tab → save the business knowledge. Integrations → web chat
   connection → enable the widget → open `{APP_URL}/widget/<key>`.
2. Chat as a homeowner ("water heater leaking, Friday after 5 works") and
   leave a name + phone. Expect: router + lead runs, a first-response
   draft in Approvals, a booking proposal honoring "Friday after 5" when
   Google Calendar is connected, and the chat as the active interaction on
   both Assistant consoles (partner tab and /client/assistant).

### Test 6 — failure honesty

1. Twilio card → Reconnect with a wrong auth token → expect an immediate
   readable failure and **nothing stored**.
2. In HubSpot, delete the private app, then send another lead with HubSpot
   live: the run completes, the CRM step reports the failure, the connection
   flips to **Needs attention** with the error in its health summary.

## 6. What success looks like

- [ ] A real lead POSTed to the intake endpoint produced an AI-routed,
      AI-drafted (or labeled-fallback) run within seconds.
- [ ] A real HubSpot contact exists with an AI Assistant note; re-sending
      updated instead of duplicating; nothing else in HubSpot was touched.
- [ ] A real SMS arrived on a real phone — but **only after** a human
      approved it, and **only while** Twilio was live. Dry-run and rejected
      paths provably sent nothing.
- [ ] Google Calendar connected via OAuth and returned real availability.
- [ ] Every step — including the ones that did *not* happen — is visible in
      Runs/Logs, the outbound integration events, and the audit trail, with
      secrets redacted everywhere.
- [ ] Turning each connection back to dry run stops real side effects
      immediately without breaking the loop.
- [ ] The **Assistant tab** made sense as a staff view of the same lead:
      interaction, AI read, draft, honest action states, and activity trail
      (see `docs/15-staff-assistant-console.md`).

## 7. Missing pieces (next after the pilot)

Shipped since this plan was first written: automatic slot proposals +
approval-gated booking, first-response drafts for form/web leads, Resend
email delivery, GoHighLevel + signed outbound webhook CRM adapters, Twilio
inbound SMS intake, durable action jobs with retry, and the built-in CRM
foundation. Still missing:

1. Background worker/queue (jobs are durable and retryable, but execution
   is synchronous and retries are manual).
2. Voice/phone provider adapter — live call features stay off until then.
3. Website chat widget UI (the intake endpoint is real).
4. Appointment reschedule/cancel flows.
5. Client-staff login for the Assistant console outside the partner app.
