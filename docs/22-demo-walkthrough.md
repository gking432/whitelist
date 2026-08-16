# 22 — Demo Walkthrough: stand it up and run the loop

The point of this doc: get the platform running locally, onboard yourself as
a partner, onboard a client business, and then watch a lead come in — the AI
analyzes it, a reply gets drafted, a booking gets requested — without needing
real phone/email accounts or provider approvals.

> **This walkthrough builds the demo tenant by hand.** `supabase/seed.sql` is
> deliberately minimal: three login accounts, one bare partner
> ("Partner Workspace"), one bare client ("Client Workspace"), and nothing
> else — no packages, integrations, workflows, knowledge, or CRM records.
> Walking the onboarding yourself *is* the test.

## 0. What you need

- **Docker** — local Supabase (Postgres + Auth + Mailpit) runs on it.
- Node 20+ (Node 22 is what the repo is developed against).
- Optional: `ANTHROPIC_API_KEY` so the AI is real instead of the labeled
  rule-based fallback. Everything below works without it.

## 1. Start the stack

```bash
npm install
npx supabase start          # boots local Auth + Postgres + Mailpit (needs Docker)
```

`supabase start` prints the API URL and keys. Put them in `.env.local`:

```bash
APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321   # keep 127.0.0.1, not localhost
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SECRETS_ENCRYPTION_KEY=<openssl rand -base64 32>   # encrypts stored provider tokens
ANTHROPIC_API_KEY=                                 # optional; real AI if set
```

> **Use `127.0.0.1`, not `localhost`.** The local dev auto-login helper
> (`isLocalDevAutoLoginEnabled` in `lib/env.ts`) only activates when
> `NEXT_PUBLIC_SUPABASE_URL` starts with `http://127.0.0.1:`. With
> `localhost` the app still works, but `/dev/auto-login` silently bounces
> you to the normal login form.

Apply migrations and seed, then run the app:

```bash
npx supabase db reset       # applies all migrations + seed.sql
npm run dev
```

## 2. Log in

Go to `http://localhost:3000/login`. The seeded accounts all use the
password `local-password-change-me`:

| Email | Role | Lands on |
| --- | --- | --- |
| `platform@northstar.test` | platform owner | `/control` |
| `partner@northstar.test` | partner owner | `/partner` |
| `client@northstar.test` | client owner | `/client` |

Shortcut: `/dev/auto-login?next=/partner` signs in the matching seed account
directly (local only, requires the `127.0.0.1` URL above).

> Login says "Authentication is not configured"? `supabase start` isn't
> running or `.env.local` is missing the URL/anon key.

## 3. Act 1 — onboard yourself as the partner

Sign in as `partner@northstar.test`. Because the seed creates **no**
`partner_onboarding` row, `/partner` redirects you straight into the
onboarding wizard. Walk it:

1. **Agency** — agency name, contact details, timezone.
2. **Branding** — product name, logo, brand colors. This is what client-facing
   surfaces and reports will carry.
3. **Team** — optionally invite a teammate. Invitations are real emails; catch
   them in **Mailpit at `http://127.0.0.1:54324`** (nothing leaves your machine).
4. **Integrations** — you can skip connecting anything here; the demo loop
   below runs entirely in dry-run.

Finishing the wizard marks onboarding complete and releases the dashboard.

## 4. Act 2 — create a package, then onboard a client

**Create a package first.** `/partner/clients/new` requires a package
(`validateFields(..., { requirePackage: true })` in
`app/partner/clients/actions.ts`) and the form has no way to proceed without
one. If you skip this you'll be stuck on a field error.

1. Go to **`/partner/packages/new`** and define what you sell — the capability
   toggles here drive the client's setup checklist, required integrations, and
   launch gates.
2. Go to **`/partner/clients/new`** and create the client business. Pick the
   package from step 1.
   - The **primary contact email is optional.** Leave it blank for a pure
     sandbox client. If you do enter one, the app sends a real invitation —
     read it in Mailpit. If that invite fails, client creation is rolled back
     and the client is deleted.
   - The seeded "Client Workspace" also exists, but it has no package, so
     creating a fresh one exercises the real path.

## 5. Act 3 — set the client up and fire a lead

Open the client → **Setup**. Work the checklist the package generated:

- **Knowledge** — services, hours, emergency + escalation rules, pricing
  disclaimer, FAQ. This is the *only* set of facts the AI is allowed to use,
  so fill it in before testing AI output.
- **Workflows** — enable the core ones (AI intake router, new-lead analysis,
  missed-call rescue) in **sandbox** mode.

Then hit **"Send a test lead"** on the Setup page. It fires a realistic
sample lead through the real pipeline (`lib/testing/test-lead.ts`) with no
connection required, and drops you on the run.

Now look at:
- **Runs** — what the AI did, step by step (analysis, drafted reply, CRM
  write), each labeled AI or rule-based fallback.
- **Approvals** — the customer-facing reply, waiting for a human. Approve it:
  with nothing connected it records a **dry run** (shows what it *would*
  send). Nothing leaves the system.
- **CRM** — the new contact, a lead, an "AI Assistant analyzed the lead"
  note, and a follow-up task.
- **Assistant console** — the same activity as a live event feed.

That is the whole product in one loop.

## 6. Act 4 — a real "customer filled out your form"

1. Client → **Setup** → lead-source wizard → connect a **web form / generic
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

3. Watch each land in Runs / Approvals / CRM, exactly like Act 3 but from a
   real external event.

Prefer a browser experience? The client can also expose the **website chat
widget** (its connection page gives a hosted `/widget/...` page) — open it as
a "visitor," chat, and the completed conversation becomes a lead through the
same rails.

## 7. Act 5 — make it real (optional)

Everything above is dry run. To see a real action:

- Connect a **Twilio** trial number (Setup → integrations), switch that
  connection to **live**, then approve an SMS draft — it actually texts the
  number on the lead. (Use your own phone as the lead's number.)
- Connect **Google Calendar** and a scheduling request will propose real open
  slots; approving books a real event.
- Connect **Resend** for real email.

Same buttons you already used — the only change is a live connection.

## 8. Act 6 — the AI answers a call

The OpenAI Realtime voice agent (docs/21) can be exercised over text with
`POST /api/voice/simulate` (needs `OPENAI_API_KEY` and a signed-in session):
`start` a call, send `caller_turn`s, then `complete` — and the same post-call
pipeline runs (summary, CRM note, approvals). The CRM AI Calls screen provides
this browser phone lab. After Twilio is connected, paste the displayed voice
and status URLs into the number and call it for the real carrier test.

## 9. Honest notes

- **Dry run by default.** Nothing customer-facing sends without a human
  approval *and* a live connection.
- **AI vs fallback** is always labeled. No AI key → deterministic fallback,
  still a full result.
- **Email invitations need a mail path.** Locally Mailpit catches everything
  at `http://127.0.0.1:54324`. In a hosted demo you must configure real SMTP
  in Supabase Auth, or every partner/client/team invitation will fail.
- **`bootstrap:owner` is production-only.** `scripts/bootstrap-platform-owner.ts`
  rejects any non-`https://` app URL, so it cannot target localhost. Locally,
  use the seeded `platform@northstar.test` account instead.
- **Sample data accumulates.** Test leads create real rows (clearly named).
  Re-running `npx supabase db reset` wipes everything back to the clean seed —
  including the partner onboarding and package you just created.
