# Demo scripts — simulate the outside world

These curl scripts pretend to be a customer contacting a business, so you
can watch the real pipeline (AI intake → analysis → approval-gated draft →
built-in CRM) without wiring up real phone/email accounts. Full walkthrough:
`docs/22-demo-walkthrough.md`.

## One-time setup

1. Stand the app up and build the demo tenant by following `docs/22` — log in
   as `partner@northstar.test` (password `local-password-change-me`), complete
   partner onboarding, create a package, then create a client business and
   give it knowledge + workflows.
2. In the app, open that client → **Setup** → the lead-source wizard, and
   connect a **web form / generic inbound** source. Its connection page shows
   a **webhook URL** and a **token** — copy both.

## Run

```bash
export INTAKE_URL="http://localhost:3000/api/integrations/inbound/<connection-id>"
export INTAKE_TOKEN="<token-from-the-connection-page>"

scripts/demo/submit-form.sh   # a website form lead → full analysis + drafted reply + CRM contact
scripts/demo/missed-call.sh   # a missed call → AI-drafted callback text (speed-to-lead)
scripts/demo/send-text.sh     # an inbound text → AI classifies it (universal intake)
```

Then watch it in the app: **Runs** (what the AI did), **Approvals** (the
draft waiting for a human), **CRM** (the new contact/lead/note), and the
**Assistant console** (the live event feed).

## Notes

- Nothing is sent to anyone. Every connection starts in **dry run**; drafts
  wait for approval and only send once you connect a provider (e.g. a Twilio
  trial number) and switch it to **live**.
- Zero-setup alternative: the **Send a test lead** button on the client's
  Setup page fires a sample lead through the same pipeline with no connection
  at all.
- With no AI key set, analysis and drafts use the labeled rule-based
  fallback — still a full result, just deterministic.
