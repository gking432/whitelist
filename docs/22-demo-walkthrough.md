# 22 — Demo Walkthrough: see it in action

The point of this doc: stand up a real fake business and actually *do things
to it* — watch a lead come in, the AI analyze it, a reply get drafted, and a
booking get requested — without needing a real client or real phone/email
accounts.

The seeded business **Summit Home Services** comes pre-onboarded so you can
skip the tedious parts and get straight to watching it work.

## 0. What you need

- **Docker** (for local Supabase) — the app's login and database run on it.
- Node 20+.
- Optional but recommended: an `ANTHROPIC_API_KEY` so the AI is real instead
  of the labeled rule-based fallback. Everything works without it.

## 1. Start it

```bash
npx supabase start          # boots local Auth + Postgres (needs Docker)
npx supabase db reset        # applies migrations + seed → creates the demo business
```

`supabase start` prints local URLs and keys. Put them in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=<API URL from supabase start>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SECRETS_ENCRYPTION_KEY=$(openssl rand -base64 32)   # encrypts stored provider tokens
ANTHROPIC_API_KEY=                                   # optional; real AI if set
```

```bash
npm run dev
```

Log in at `http://localhost:3000/login` as **`partner.owner@example.test`**
(seed password: `local-password-change-me`).

> Not seeing login work? `supabase start` must be running and `.env.local`
> filled in — the login page says "Authentication is not configured" until
> then.

## 2. What's already set up

You land on the **partner dashboard** with the **Start here** guide. The
demo partner (Acme) has three clients; **Summit Home Services** is the one
that's ready to demo:

- Built-in CRM mode (leads land in the CRM tab you can see).
- An approved **Knowledge** profile (services, hours, emergency + escalation
  rules, pricing disclaimer, FAQ) — the only facts the AI is allowed to use.
- The core workflows enabled in **sandbox** (dry run): AI intake router,
  new-lead analysis, missed-call rescue.

## 3. Act 1 — watch a lead flow, zero setup

Open **Summit Home Services → Setup → step 6 → "Send a test lead."** It fires
a realistic sample lead through the real pipeline and drops you on the run.

Then look at:
- **Runs** — what the AI did, step by step (analysis, the drafted reply, the
  CRM write), each labeled AI or rule-based fallback.
- **Approvals** — the customer-facing reply, waiting for a human. Approve it:
  with nothing connected it records a **dry run** (shows what it *would*
  send). Nothing leaves the system.
- **CRM** — the new contact, a lead, an "AI Assistant analyzed the lead"
  note, and a follow-up task.
- **Assistant console** — the same activity as a live event feed.

That is the whole product in one loop.

## 4. Act 2 — a real "customer filled out your form"

1. Summit → **Setup** → lead-source wizard → connect a **web form / generic
   inbound** source. Its connection page shows a **webhook URL** and a
   **token**.
2. Simulate submissions from a terminal:

   ```bash
   export INTAKE_URL="http://localhost:3000/api/integrations/inbound/<connection-id>"
   export INTAKE_TOKEN="<token>"

   scripts/demo/submit-form.sh   # website form lead → analysis + drafted reply + CRM
   scripts/demo/missed-call.sh   # missed call → AI-drafted callback text
   scripts/demo/send-text.sh     # inbound text → AI classifies it
   ```

3. Watch each land in Runs / Approvals / CRM, exactly like Act 1 but from a
   real external event.

Prefer a browser experience? Summit can also expose the **website chat
widget** (its own connection page gives a hosted `/widget/...` page) — open
it as a "visitor," chat, and the completed conversation becomes a lead
through the same rails.

## 5. Act 3 — make it real (optional)

Everything above is dry run. To see a real action:

- Connect a **Twilio** trial number (Setup → integrations), switch that
  connection to **live**, then approve an SMS draft — it actually texts the
  number on the lead. (Use your own phone as the lead's number.)
- Connect **Google Calendar** and a scheduling request will propose real open
  slots; approving books a real event.
- Connect **Resend** for real email.

Same buttons you already used — the only change is a live connection.

## 6. Act 4 — the AI answers a call (simulated)

The OpenAI Realtime voice agent (docs/21) can be exercised over text with
`POST /api/voice/simulate` (needs `OPENAI_API_KEY` and a signed-in session):
`start` a call, send `caller_turn`s, then `complete` — and the same
post-call pipeline runs (summary, CRM note, approvals). A screen to watch
this live is the recommended next build.

## 7. Honest notes

- **Dry run by default.** Nothing customer-facing sends without a human
  approval *and* a live connection.
- **AI vs fallback** is always labeled. No AI key → deterministic fallback,
  still a full result.
- **Sample data accumulates.** Test/demo leads create real rows (clearly
  named). Re-running `npx supabase db reset` wipes everything back to the
  clean seeded demo.
