# 23 — Deploy it and connect your real tools

Goal: get Northstar running at a real public URL, onboard a real business
(use your own accounts), and connect the tools that are genuinely wired so
you can test them live. Follow this top to bottom.

## What's actually connectable (read this first)

Don't make accounts for things that aren't wired yet.

**Connect and test live today:**

| Tool | How | Verify live |
| --- | --- | --- |
| HubSpot | Private-app token | Leads appear as HubSpot contacts + notes |
| Twilio (SMS) | SID + auth token + number + inbound webhook | Inbound texts trigger AI; approved replies send |
| Google Calendar | Your own OAuth client (per-connection) | AI proposes real slots; approving books an event |
| Resend (email) | API key + verified sender domain | Approved emails actually send |
| Website | Chat widget embed, or forms → intake webhook | Visitors/forms become leads |
| Anything else (GBP, Facebook, IG, Typeform…) | Zapier/Make → generic inbound webhook | Bridged leads flow through the AI |

**NOT wired yet — don't expect these to plug in:**

- **AI answering phone *calls*.** Twilio texts work; the AI picking up a call
  needs a phone bridge that doesn't exist yet (docs/21). Voice is
  simulation-only.
- **Native Google Business Profile / social connectors.** Route them in via
  an automation bridge to the webhook instead.

---

## Part A — Deploy

### A1. Supabase (auth + database)

1. Create a project at supabase.com. Note the **Project URL**, **anon key**,
   and **service_role key** (Project Settings → API).
2. Point the CLI at it and push the schema (migrations only — the local
   `seed.sql` is for local dev and creates fake test users you don't want in
   production):
   ```bash
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push
   ```
   This creates every table plus the **provider catalog and workflow
   templates** (those live in migrations, not the seed).
3. Auth → URL Configuration: add your future app URL's callback to **Redirect
   URLs**: `https://<your-app>.vercel.app/auth/callback`. Email sign-in works
   on Supabase's built-in email out of the box (low rate limits — add SMTP
   later for volume).

### A2. Vercel (the app)

Import the repo in Vercel and set these environment variables:

| Variable | Value | Needed for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project URL | required |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key | required |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role key | required (server) |
| `SECRETS_ENCRYPTION_KEY` | `openssl rand -base64 32` | encrypts stored provider tokens |
| `NEXT_PUBLIC_APP_URL` | `https://<your-app>.vercel.app` | OAuth + webhook URLs |
| `ANTHROPIC_API_KEY` | your key | real AI (else labeled fallback) |
| `OPENAI_API_KEY` | your key | voice assistant (docs/21) |
| `VOICE_PROVIDER` | `openai_realtime` | enables the voice adapter |
| `CRON_SECRET` | `openssl rand -hex 24` | the retry job runner |

Deploy. Set `NEXT_PUBLIC_APP_URL` to the real URL Vercel gives you and
redeploy if it changed.

### A3. Give yourself an account (there's no signup yet)

The app only lets in emails that already have a membership. Bootstrap
yourself once:

1. Go to `https://<your-app>.vercel.app/login`, enter **your real email**,
   click the sign-in link. (This creates your auth user + profile via a
   trigger. You'll land on "Partner access required" — expected.)
2. In Supabase → SQL Editor, run:
   ```sql
   -- 1) create your partner org
   insert into public.partners (name, slug, status)
   values ('My Company', 'my-company', 'active')
   returning id;

   -- 2) link your login to it as owner (uses the email from step 1)
   insert into public.memberships (user_id, partner_id, client_id, role, status)
   select u.id, p.id, null, 'partner_owner', 'active'
   from auth.users u
   cross join public.partners p
   where u.email = 'you@youremail.com'
     and p.slug = 'my-company';
   ```
3. Sign in again → you land on the partner dashboard with the **Start here**
   guide.

### A4. (optional) Background job retries

In Vercel → Cron Jobs, schedule `POST /api/jobs/run` every few minutes with
header `Authorization: Bearer <CRON_SECRET>`.

---

## Part B — Onboard your business

In the app: **Add client** → open it → **Setup**. Work the checklist: pick a
package, fill in the **Knowledge** tab (your real services, hours, rules —
this is the only info the AI is allowed to use), and enable the workflows.
Everything starts in **dry run**.

---

## Part C — Connect each real tool

All of these are on the client's **Setup / Integrations** page. Each is
verified against the real provider before it saves, and each starts in dry
run until you switch it to **live**.

### HubSpot (CRM)
HubSpot → Settings → Integrations → **Private Apps** → create one with scope
`crm.objects.contacts` (read + write). Copy the **access token**, paste it as
the **Private app access token**. Test → send a lead → see the contact + AI
note appear in HubSpot.

### Twilio (SMS)
1. Twilio console → Account SID, Auth token, and a **phone number** (a trial
   number is fine).
2. In the app, connect Twilio with those three fields.
3. In Twilio, set the number's **inbound "A message comes in" webhook** to:
   `https://<your-app>.vercel.app/api/integrations/inbound/twilio/<connection-id>`
   (the connection page shows the exact URL).
4. Text that number → watch it become a lead. Switch the connection to
   **live**, approve an outbound draft → it really sends.

### Google Calendar (booking)
1. Google Cloud Console → create an **OAuth client (Web application)**. Set
   the **Authorized redirect URI** to
   `https://<your-app>.vercel.app/api/oauth/google/callback`.
2. In the app, paste the **OAuth client ID** and **secret**, click Connect,
   approve with your Google account. It runs a live free/busy check to verify.
3. A scheduling lead now proposes real open slots; approving books a real
   event (live mode only).

### Resend (email)
Resend → verify your sending domain, create an **API key**. Connect with the
key + a **from address** on that domain. Switch to live → approved emails
send for real.

### Website
- **Chat widget:** connect the web-chat source; its page gives you an embed
  snippet and a hosted `/widget/...` page. Drop the snippet on your site.
- **Forms:** point your form's submit (or a Zapier step) at the generic
  inbound webhook (below).

### GBP, Facebook, Instagram, etc. (via bridge)
There's no native connector, but this works today: in the app, connect a
**generic inbound web form** source — it gives you a webhook URL + token.
Then in Zapier/Make, trigger on a new GBP message / FB lead / IG DM and send
a POST to that URL with header `x-webhook-token: <token>` and body:
```json
{ "event_type": "lead.created",
  "data": { "name": "...", "phone": "...", "email": "...", "message": "..." } }
```
Now those leads flow through the same AI pipeline as everything else.

---

## Part D — Test everything live

For each connected tool, run a real event and watch it land in **Runs**,
**Approvals**, **CRM**, and the **Assistant console**:

- HubSpot: submit a website form → contact + note in HubSpot.
- Twilio: text your number → lead → approve reply → you get a text back.
- Calendar: send a "can someone come Tuesday?" lead → approve → event booked.
- Resend: approve an email draft → it arrives.
- Bridge: fire a GBP/FB test through Zapier → lead appears.

Every send is gated by a human approval **and** a live connection — nothing
customer-facing goes out until both are true.

## Honest gaps to keep in mind

- **AI phone answering** is the one marquee tool not connectable yet — needs
  the phone bridge (docs/21). Everything above is real.
- No self-serve signup or in-app billing yet — you bootstrapped your account
  by hand above.
