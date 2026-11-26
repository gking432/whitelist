# 19 — Website AI Chat Widget

A minimal, production-shaped chat assistant that lives on a client
business's website, answers only from approved knowledge, captures the
lead, and feeds Northstar's normal intake rails.

## Setup (exact clicks)

1. Client workspace → **Knowledge** tab → fill in the approved business
   knowledge (description, services, areas, hours, FAQ, disclosure). The
   assistant refuses to go beyond this content.
2. Setup tab → lead source wizard → create the **Northstar web chat**
   connection (if the client doesn't have one yet).
3. Integrations → open the web chat connection → **Website chat widget**
   card → **Enable widget**. This generates the public widget key
   (`wk_…`) and shows:
   - the hosted chat page: `{APP_URL}/widget/<key>` (test it directly)
   - the iframe embed snippet to paste before `</body>` on the client's
     site.
4. Rotate the key any time — previously embedded widgets stop working.

## How it works

- `POST /api/widget/<key>/session` starts a visitor session (rate-limited
  per key + IP). The greeting always includes the AI disclosure.
- `POST /api/widget/<key>/message` handles each visitor message: the AI
  replies from approved knowledge (Anthropic via `ANTHROPIC_API_KEY`;
  a deterministic scripted fallback runs without it — the widget never
  dies), extracts name/phone/email/address/service need/urgency/
  appointment preference as the visitor shares them, and stores the
  transcript on the `chat_sessions` row.
- When the conversation completes with at least a phone or email, it
  becomes a normal intake event (`chat.conversation_completed`,
  idempotent per session) → AI intake router → lead workflows → CRM sync
  → approval-gated drafts. It shows up in Runs/Logs, Approvals, the
  Assistant consoles, and the built-in CRM like every other lead.

## Security & honesty

- The widget key is **public by design** — it only lets visitors start a
  chat for that one client. Sends/bookings still require human approval
  and live-mode connections; the widget itself never triggers side
  effects beyond intake.
- Rate limits on both endpoints; 40-message cap per session; 2000-char
  cap per message; payloads pass the standard redaction before logging.
- The hosted page shows only the client business's name plus "AI
  assistant · a human confirms everything" — no partner or Northstar
  branding (docs/12: homeowners never see the platform).

## Test it

1. Open `{APP_URL}/widget/<key>` in a private window.
2. Say "my water heater is leaking, can someone come Friday after 5?" and
   answer the assistant's questions with a name + phone.
3. Watch: Runs/Logs gets router + lead runs, a first-response draft waits
   in Approvals, a booking proposal appears if Google Calendar is
   connected (honoring "Friday after 5"), and the Assistant tab shows the
   chat as the active interaction.
