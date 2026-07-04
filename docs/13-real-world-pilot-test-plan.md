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

Real and testable end-to-end today:

- Secured inbound intake (webhook/web chat endpoint with token auth,
  idempotency, rate limiting, redacted logs).
- AI intake routing and reply drafting (Claude when `ANTHROPIC_API_KEY` is
  set; clearly-labeled rule-based fallback when not).
- HubSpot contact upsert + note, with a **dry-run preview** of the exact
  payload until you flip the connection to live. Marked **safe** because it
  is additive-only: it never deletes, never changes deal stages, never clears
  fields.
- Approval-gated Twilio SMS delivery. Sending happens **only** after a human
  approves, and **only** if the Twilio connection is in live mode. Every
  other case is recorded honestly as `dry_run` or `skipped`.
- Google Calendar connect (OAuth), live availability check on connect/test,
  and an event-creation adapter.

Not fully real yet (documented, not hidden):

- **No workflow books calendar events automatically.** The Google connection
  verifies with a real free/busy read and `createCalendarEvent` exists and
  works, but the booking workflow that would call it is not wired. Booking is
  the next milestone.
- **Email delivery is not wired.** Drafts whose channel is email are approved
  and recorded, with an explicit "send manually" outcome message. SMS only.
- **GoHighLevel and other CRMs are not in the pilot.** HubSpot only.
- **Voice/phone calls** are design contracts only (see docs/11); Twilio here
  is SMS-only.
- The run engine executes synchronously in the request; fine for pilot
  volume, queued execution comes later.

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
5. **Anthropic API key** (optional, recommended) — console.anthropic.com. If
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
   `<your NEXT_PUBLIC_APP_URL>/api/oauth/google/callback`
   e.g. `http://localhost:3000/api/oauth/google/callback` for local runs.
   The Pilot Stack screen shows this exact value on the Google card so you
   can copy it.
6. Copy the **Client ID** (`…apps.googleusercontent.com`) and **Client
   secret** (`GOCSPX-…`).

## 3. Exact environment variables

`.env.local` (see `.env.example`):

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000        # or your deployed URL
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>     # server-only
SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32> # server-only, 32 bytes b64
ANTHROPIC_API_KEY=<sk-ant-…>                     # optional
```

Notes:

- `SECRETS_ENCRYPTION_KEY` encrypts every provider credential at rest and
  signs the Google OAuth state. Without it, the Pilot Stack screen refuses to
  store credentials (with a clear message).
- HubSpot/Twilio/Google credentials are **not** environment variables — you
  paste them into the Pilot Stack screen per client, and they are stored
  encrypted per connection.
- Database: apply all migrations in `supabase/migrations/` (Supabase CLI:
  `npx supabase db push`, or run them in the SQL editor in filename order).
  `supabase/seed.sql` creates the local demo partner/client and logins for
  local development.

## 4. Exact clicks in Northstar

Assume you are signed in as a partner user (locally the dev auto-login signs
you in as `partner.owner@example.test`).

### A. Create (or open) the client

1. **Partner → Clients → New client** — create e.g. "Pilot Plumbing Co", or
   open an existing client.
2. You land in the client workspace; the tabs across the top are the map:
   Setup, **Pilot Stack**, Integrations, Workflows, Runs/Logs, Approvals…

### B. Set up the lead intake

1. **Setup tab** → run the lead-source wizard → choose the simplest path
   (website form / webhook).
2. This creates an inbound connection. Open it (Integrations tab) and copy:
   - the endpoint path `/api/integrations/inbound/<connectionId>`
   - the one-time webhook token (shown once — save it now).

### C. Enable the workflows

1. **Workflows tab** → enable **Lead Response** (`new_lead_intake`) and
   **AI Intake Routing** (`ai_intake_router`) if they are not already active.
2. Leave approval requirements at their defaults — customer messages require
   approval.

### D. Connect the pilot stack

**Pilot Stack tab.** Each card says in plain language what the connection
allows and what it will never do.

1. **HubSpot** — paste the private app token → **Verify & connect**.
   Northstar calls HubSpot with the token before storing it; a typo fails
   immediately with a readable message.
2. **Twilio** — paste Account SID, Auth Token, sending number →
   **Verify & connect**. Same live verification.
3. **Google Calendar** — paste OAuth Client ID + secret → **Save & authorize
   with Google** → Google consent screen → approve. You land back on the
   Pilot Stack page; the card shows a live availability check result
   ("primary calendar has N busy blocks in the next 7 days").
4. Every connection starts in **dry run**. Leave them there for the first
   test.

## 5. Exact tests to run

### Test 1 — dry run end-to-end (nothing real leaves the system)

Send a lead to the intake endpoint (replace the id, token, and phone):

```bash
curl -X POST "$APP_URL/api/integrations/inbound/<connectionId>" \
  -H "content-type: application/json" \
  -H "x-webhook-token: <token>" \
  -d '{
    "event_type": "lead.created",
    "idempotency_key": "pilot-test-001",
    "data": {
      "name": "Taylor Testlead",
      "email": "taylor.testlead@example.com",
      "phone": "+1<your verified cell>",
      "address": "12 Pilot Ln",
      "message": "Water heater is leaking, can someone come out this week?"
    }
  }'
```

Expect `200` with a processed/run summary. Then verify, in order:

1. **Runs/Logs tab** — a Lead Response run in **Awaiting approval**, plus an
   AI Intake Routing run. Open the Lead Response run: you should see the
   analysis/draft steps, whether AI or fallback produced them, and a **CRM
   sync (dry run)** step containing the exact HubSpot payload that would have
   been sent.
2. **Approvals tab** — a pending customer-message draft with the SMS text
   and destination number.
3. Approve it. The result message should say it was recorded as a **dry
   run** because Twilio is not live. The run summary and the outbound
   `sms.customer_message` event (status `dry_run`) both say the same.
4. Nothing appeared in HubSpot, no SMS arrived — correct, everything was in
   dry run and said so.

### Test 2 — live CRM sync

1. Pilot Stack → HubSpot card → **Go live**.
2. Re-send the curl with `"idempotency_key": "pilot-test-002"`.
3. Run detail now shows **CRM synced** with the HubSpot contact id, and in
   HubSpot a contact "Taylor Testlead" exists with an
   **"AI Assistant — Northstar"** note. Send it a third time: the contact is
   **updated**, not duplicated.

### Test 3 — live approved SMS

1. Pilot Stack → Twilio card → **Go live**.
2. Send `"idempotency_key": "pilot-test-003"` with your verified cell in
   `data.phone`.
3. Approvals → open the draft → optionally **edit** the message → approve.
4. The result message shows the Twilio message SID; your phone receives the
   SMS. The outbound event is `sent`, and the audit trail shows who approved
   and when.
5. Reject a fourth lead's draft: no SMS, run marked cancelled — the gate is
   real in both directions.

### Test 4 — calendar connection health

1. Pilot Stack → Google Calendar card → **Test connection**. Expect the
   busy-block count from the real calendar. Add an event in Google Calendar,
   test again, and the count changes.
2. That is the extent of the calendar loop today — see honest status above.

### Test 5 — failure honesty

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

## 7. Missing pieces (next after the pilot)

1. Automatic appointment booking: a scheduling workflow that proposes slots
   from free/busy and creates the event after approval.
2. Email delivery channel (likely Resend/SendGrid) behind the same approval
   gate.
3. GoHighLevel adapter as the second CRM.
4. Queued (async) run engine and delivery retries with backoff.
5. Twilio inbound SMS → `sms.received` intake wiring, so replies flow back
   into the intake router automatically.
