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
| Twilio (SMS + Voice) | Partner parent account provisions client subaccounts/numbers, or connect an existing client Twilio number | Inbound texts trigger AI; approved replies send; calls use AI answering or staff-assisted mode |
| Google Calendar | Your own OAuth client (per-connection) | AI proposes real slots; approving books an event |
| Resend (email) | API key + verified sender domain | Approved emails actually send |
| Website | Chat widget embed, or forms → intake webhook | Visitors/forms become leads |
| RingCentral / Dialpad / Quo | Platform OAuth for RingCentral and Dialpad; client API key for Quo | Real calls open the assistant, match CRM contacts, and create post-call activity |
| Jobber / Housecall Pro / ServiceTitan / Workiz | OAuth or vendor credentials | Customers, leads, jobs, and appointments sync with the built-in CRM |
| QuickBooks / Stripe / Square / CallRail | OAuth or restricted vendor credentials | Financial status and attributed leads sync into reporting and CRM context |
| Meta Lead Ads / Google Ads | Platform OAuth app; client signs in once | Leads enter the CRM and the latest 30-day campaign metrics appear in Marketing |
| Google Business Profile / Podium / Birdeye | OAuth for GBP and Podium; Birdeye API key | Reviews populate reputation reporting; approved replies can be pushed where supported |
| Angi / Thumbtack / Yelp / other email-notification sources | Activate the private forwarded lead inbox | Notification emails are authenticated, parsed, and routed through normal lead intake |
| Anything else | Native connector when listed; otherwise secured inbound webhook | Bridged leads flow through the same AI and workflow pipeline |

**Restricted or still awaiting vendor access:**

- **Marketplaces such as Angi, Thumbtack, and Yelp.** Their broad lead APIs
  require approved commercial access. The private forwarded lead inbox is the
  built-in fallback and does not require the client to open another automation account.
- **Google Local Services lead delivery and some provider review APIs** require
  product approval or account eligibility beyond ordinary OAuth. The connector
  remains disabled until the vendor grants that access; the lead inbox/webhook
  fallback remains available.

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

Add the platform OAuth application credentials from `.env.example` for every
provider you plan to offer. Clients authorize their own accounts; partners do
not see or store the resulting access tokens.

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

### Twilio (SMS + Voice)
1. The partner connects its parent Twilio Account SID and Auth Token during
   partner onboarding or from partner settings.
2. The client connection flow can create a Twilio subaccount, purchase a
   voice/SMS-capable number by area code, and configure all inbound webhooks.
3. Choose **AI answered** or **Staff assisted** phone handling. Staff assisted
   also requires a forwarding number and the always-on voice-stream service.
4. Text and call the number. Texts enter the normal AI intake flow. Calls
   create a call session, resolve or create the CRM customer, preserve notes,
   and run the configured post-call actions.
5. Existing business numbers can forward to the provisioned Twilio number for
   a pilot and can be ported later.

### Keep an existing RingCentral, Dialpad, or Quo phone system
1. In the partner's client connection link, select the phone system the client already uses.
2. The client signs into RingCentral or Dialpad, or enters its Quo API key, on the branded secure page.
3. The platform registers signed webhooks automatically after deployment over HTTPS.
4. A ringing event opens the desktop assistant and resolves the caller against the CRM. Messages enter the normal SMS workflow; completed calls create CRM activity and follow-up work.
5. Retained systems support the live and post-call data their standard APIs expose. The full in-call audio scheduling coach uses managed Twilio unless the retained provider grants compatible live media access.

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

### Meta Lead Ads and campaign reporting
1. Create one platform Meta app and set `META_APP_ID`, `META_APP_SECRET`, and
   `META_WEBHOOK_VERIFY_TOKEN`.
2. Add `https://<your-app>/api/oauth/meta/callback` as the OAuth redirect and
   `https://<your-app>/api/integrations/inbound/meta` as the Page webhook.
3. Obtain Meta App Review approval for the scopes listed in `.env.example`.
4. In the secure client link, the client signs into Facebook and authorizes
   its Page. The app discovers the Page and ad account, subscribes leadgen
   webhooks, and syncs 30-day campaign snapshots.

### Google Ads and Google Business Profile
1. Add these OAuth redirects to the same Google Cloud web client:
   `https://<your-app>/api/oauth/google_ads/callback` and
   `https://<your-app>/api/oauth/google_business_profile/callback`.
2. Set `GOOGLE_ADS_DEVELOPER_TOKEN` for Ads API access.
3. The client authorizes each product from the secure setup link. The app
   discovers the first accessible Ads customer or Business Profile location,
   verifies it, and queues the matching campaign, lead, or review sync.

### Podium and Birdeye
1. Set the platform `PODIUM_OAUTH_CLIENT_ID` and `PODIUM_OAUTH_CLIENT_SECRET`,
   with redirect `https://<your-app>/api/oauth/podium/callback`.
2. Podium clients authorize with OAuth. Birdeye clients enter their own
   Business ID and API key in the secure setup page.
3. Reviews enter Marketing/Reputation. Public replies remain approval-gated.

### Private forwarded lead inbox
1. Configure Resend Receiving and set `PLATFORM_RESEND_API_KEY`,
   `RESEND_WEBHOOK_SECRET`, and `RESEND_INBOUND_DOMAIN`.
2. Point Resend's receiving webhook at
   `https://<your-app>/api/integrations/inbound/email/resend`.
3. The client clicks **Activate private lead inbox** and receives a unique
   `lead-<connection-id>@<domain>` address.
4. Put that address in Angi, Thumbtack, Yelp, or any source that can email a
   lead notification. The client does not need Zapier, Make, or n8n.

### Unsupported sources (via webhook bridge)
When a native connector is not available, connect a
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

- Twilio AI answering is turn-based rather than full-duplex streaming. The
  staff-assisted path uses the WebSocket audio stream for live transcription.
- The phone paths still need real deployed-account verification before they
  can be called production-proven.
- No self-serve signup or in-app billing yet — bootstrap or invite the initial
  partner account before onboarding.
- Connector contracts are tested against published vendor APIs. Each provider
  still needs one live credential verification before it is marked live-verified.
