# 15 — Staff Assistant Console

## What this is

The Staff Assistant Console is the seed of Northstar's future staff app —
the small popup that helps a client business employee **while they work**:
on a call, answering a chat, replying to an email, or scheduling a job.

It is **not** a manager analytics dashboard. It is one narrow, compact,
action-first window that answers three questions:

1. What is happening right now (who, which channel, what do they want)?
2. What does the AI already know or suggest?
3. What can I do about it with one click — and what happens if I do?

## Where to click

```text
Partner → Clients → open a client → Assistant tab
/partner/clients/[clientId]/assistant
```

The console renders inside the partner web app today. That is deliberate
(see "Future runtimes" below) — the prototype proves the interaction model
before any desktop/extension work.

## What it shows

Top to bottom, one column, styled like a small app window:

- **Window bar** — client name plus an honest **Live data / Preview** badge.
- **Active interaction** — channel (phone, SMS, email, website chat, form,
  Google Business, manual), when it arrived, contact details, the message
  or voicemail text, and the CRM match (HubSpot contact id or "no match
  yet").
- **AI read** — intake category (sales, customer service, scheduling,
  urgent, billing, PR/media, spam…), urgency, confidence, missing fields,
  and the suggested next question/action. Labeled **AI**, **rule-based
  fallback**, or **Preview** — never unlabeled.
- **Draft reply** — the AI-drafted SMS/email with its approval status,
  a **Review & approve** jump to the approval queue, and **Copy text**.
- **Suggested appointment slots** — always labeled preview until the
  booking workflow ships.
- **CRM sync status** — synced / dry run / failed / skipped, in plain words.
- **Action grid** — the eight actions below, each with an honest state chip.
- **Recent assistant activity** — the last workflow runs and audit events.
- **Runtime footer** — which package is active, what was sold ahead of the
  product, and which runtimes come later.

## Actions: real vs preview (current release)

| Action | State logic |
| --- | --- |
| Send SMS | **Real via approval gate.** Works now (Twilio live) / Dry run (Twilio dry run) / Requires Twilio (not connected) / Not in this package. The button jumps to the waiting draft in Approvals — the console never bypasses the approval gate. |
| Send email | **Real via approval gate** (Resend). Works now (live) / Dry run / Requires email provider. |
| Book appointment | **Real via approval gate.** Scheduling requests propose real open slots from Google Calendar free/busy; approving books the event (live mode only). Requires Google Calendar when not connected. |
| Add CRM note | **Works now, automatically** — the AI Assistant note is attached with every CRM sync. Requires CRM if none is connected. |
| Sync to CRM | **Real button.** Re-runs the additive contact + note sync for the latest lead (HubSpot, GoHighLevel, or signed outbound webhook). Works now (live) / Dry run / Requires CRM. |
| Create task | **Coming soon** — the AI already suggests the task; pushing it into a task system needs the CRM task adapter. |
| Escalate | **Real button.** Records an escalation (with an optional note) in the audit trail. Manager notifications come with the notification pack. |
| Copy fallback | **Real button.** Copies the draft text to the clipboard — the fallback when a provider is not connected. |

Honest state chips used everywhere: `Works now`, `Dry run`,
`Requires Twilio`, `Requires CRM`, `Requires Google Calendar`,
`Preview only`, `Coming soon`, `Not in this package`.

## How it ties into packages and setup

- The console only surfaces capabilities the client's **selected package**
  includes. No package → actions stay locked with a plain explanation.
- Capabilities sold ahead of the product (AI phone answering, live call
  assistant, live scheduling assistant…) appear in a **"Sold ahead of the
  product"** list with the exact status note from the capability catalog.
- The footer states the staff runtime truth: **the web console works now**;
  desktop tray app, browser extension, CRM-native extension, and the
  website widget are later runtimes for this same console.

## How it fits the real-world pilot test (docs/13)

docs/13 runs a real lead through intake → AI → HubSpot → approval → Twilio.
The Assistant tab is the **staff view of that same lead**: after sending the
test event, open Assistant and confirm the interaction, the AI read, the
waiting draft, the CRM status, and the action states match reality (dry run
vs live). Success criteria in docs/13 §6 include this check.

If the client has no runs yet, the console shows a **clearly labeled
Preview** with sample data — never presented as live.

## Architecture: built to leave the web app

Long term, staff may live inside a CRM, phone app, inbox, or scheduling
tool. A browser tab — or even a browser extension — may not be enough; the
final version may need to be a lightweight desktop/tray app, CRM overlay,
or native assistant that pops up over other software.

The prototype is structured for that move:

- `lib/assistant/context.ts` builds one **JSON-serializable
  `AssistantContextData`** object — interaction, AI read, draft, CRM state,
  action list with honest states, activity, runtime requirements. No
  framework types, no React in the contract.
- `components/assistant/assistant-console.tsx` is a self-contained window
  that renders that object. It does not know it lives in the partner app.
- Real actions go through ordinary server actions with the same permission
  checks, tenant scoping, and audit events as the rest of Northstar.

What the future runtimes need (deliberately **not** built yet):

1. An authenticated `/api/assistant/context` endpoint serving
   `AssistantContextData` (the builder is already runtime-agnostic).
2. A push channel (SSE/WebSocket) so a new call/chat pops the console up
   instead of waiting for a refresh.
3. Trigger sources: phone-provider call events, CRM page context (from an
   extension), inbox context.
4. The thin shells: Electron/Tauri tray app, MV3 browser extension,
   CRM-native app — each is chrome around the same console + contract.
5. Client-staff authentication for the console outside the partner app
   (client-role memberships already exist).

## Current limits (honest)

- Lives in the partner workspace; client-staff login for the console is not
  wired yet.
- No real-time push — refresh to see a new interaction.
- Appointment slots are real once a scheduling request produces a booking
  proposal; before that the console shows clearly-labeled preview slots.
- Escalate records to the audit trail; it does not notify anyone yet.
- Preview mode uses sample data and says so; it never fakes a live state.
