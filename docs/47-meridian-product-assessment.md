# Meridian: product assessment, operating model and plan

Written November 27, 2026 by the incoming product, design and engineering lead. This is based on the `codex/v1-scenario-lab` branch (gking432/whitelist PR #2). I ran the app against a local Supabase with all 106 migrations, created new owners through the real sign-up screens, and drove each screen in a browser. I also read the code behind every owner area.

## 0. v1 definition (owner direction, November 27)

**Meridian v1 is a single-pane operating hub for solo entrepreneurs: "do your job from one screen."** A solo owner uses about ten apps every day. Meridian collapses them into one pane.

- **The owner works in the pane.** Agents operate the other apps in the background: CRM, email, calendar, billing, marketing.
- **The owner's step is read, then approve.** Workflows can be long; agents do almost all of the steps.
- **The CRM is infrastructure, not a screen.** Customer context appears inside the decision that needs it. The owner should never have to open the CRM.
- **Background agents create the work.** Example: sales and marketing agents draft emails to warm and recycled leads, and the owner reads and sends them from the pane.
- **The owner can still open their usual apps,** but never has to.
- **Full autonomy is optional for v1.** Low-stakes tasks may become fully autonomous later. The single pane comes first.

This sharpens the rest of the document. Where earlier sections disagree, this section wins:
- Today *is* the product.
- Department pages are optional "full views".
- Agents and Apps are "behind the scenes".
- Agent output arrives in the pane as decisions, grouped when there are many of the same kind.

## 1. Verdict

Meridian's foundation is better engineered than its product. The data layer is careful: tenancy, row-level security, idempotent commands, durable action jobs, approval immutability, delivery receipts and 1,000+ tests. Most early products don't have that, and it is the right base for an agent that acts on a business's behalf.

As a product, though, Meridian can't yet run a business. A new owner can sign up and look around. Then they hit a wall: every connection reads "Setup unavailable", agents are paused, and Messages, Calendar and Money only display records. Real actions are mostly limited to website chat. The public sample shows the right idea: decisions with context, inline edits, and actions that update other screens. Most of that interactivity exists only in the sample.

The biggest risk isn't missing code. It's **scope sprawl**: about 90 routes covering a partner portal, agency white-labeling, a platform control room, a second CRM, a test center and a personal-assistant preference. Each adds maintenance and confusion. Meanwhile the one loop that matters is still incomplete: a customer writes, Meridian prepares a response, the owner approves, it's delivered, and the result is recorded.

## 2. What actually works (verified end to end)

| Area | Status | Evidence |
|---|---|---|
| Owner sign-up and business creation | **Works** | Created two owners through `/start`, which provisions the business, membership and package |
| Onboarding wizard | **Works, but thin** | Saves every step server-side. Finishing it turns nothing on (see §3) |
| Today (signed in) | **Works on empty data** | Loads approvals, tasks, appointments, conversations and agent work. With nothing connected it's a page of empty states |
| Website chat conversation | **Works** | Inbound message → conversation and lead → owner reply → approval → action job → delivered, with status shown in the thread |
| Approvals | **Works** | Atomic resolution, delivery dispatched in the same request, audit event written, honest outcome text |
| Customers (shared records) | **Works** | Add or edit customers; agents use the same records |
| Manager chat | **Works for commands; needs AI for open questions** | Without an Anthropic key, only fixed commands work |
| Unit and contract tests | **1,026 pass** | `npm test` |

## 3. Partial, mock or blocked

**Gated by configuration (code exists, never proven live here).** Gmail/Google Calendar, Outlook/Microsoft Calendar, HubSpot and Stripe all need platform OAuth credentials. The owner sees "Setup unavailable" and "Ask your administrator", which is a dead end for a solo owner. `docs/46` says live provider acceptance is still pending. Any connection with real delivery is also blocked by a database rule requiring the owner to approve a "supervised beta launch checklist" first.

**Read-only where the vision needs action:**
- **Messages:** synced email is a list that tells the owner to "open a thread in its source app to read or reply." Conversation replies are delivered only on website chat and Instagram. On email or SMS the delivery adapter returns "This channel does not have a connected delivery adapter." So the owner cannot answer a customer email or text from Meridian.
- **Calendar:** shows imported events only. Inline week/day editing works only in the sample (`inline-week-calendar.tsx` enables editing only when `preview` is set).
- **Money:** shows imported invoices and payments only. There's no create or send invoice, no payment link and no reminder action. The page says to "verify current details there before taking action."
- **Calls:** voice, Twilio and OpenAI Realtime code exists (`lib/voice`, `services/voice-stream`), but calls don't appear anywhere in the owner app.
- **Projects and team work:** To-do is a task list. There are no projects or jobs, no assignment to staff, and no staff view.
- **Marketing:** a records page under "More tools", with nothing an agent runs.

**Mock (sample only).** The whole `/preview` app is client-side state in session storage. "Handled for you", the business pulse metrics, the bill-pay decision and the monthly report are fictional. They are clearly labeled, which is good. The risk is that the sample is the most capable version of Meridian, so it sets expectations the signed-in product can't meet.

**Agents.** The catalog defines about 10 agents (customer service, scheduling, sales follow-up and others). They need an Anthropic key, start paused, and every channel's authority defaults to off. Out of the box, nothing runs. The default model ID in `lib/ai/provider.ts` is outdated and should point to a current Claude model.

## 4. Broken paths I found and fixed

1. **Manager chat printed "Set undefined authority to undefined"** six times for every new owner. Onboarding steps share the owner-command table and were rendered as chat messages. Chat now shows only chat commands, and labels can't render `undefined`.
2. **An owner's own reply needed a second approval on another screen.** Typing a reply created an approval and sent the owner to Approvals to approve their own words. Once approved, delivery was still blocked because agent channel authority defaults to off. Now a reply the owner writes is approved in the same step, keeping the audit record and guarded delivery, and the result shows in the thread. Agent authority and team pause no longer block a person's own reply. Opt-outs, stale-thread checks, expiry and paused-channel checks still apply.
3. **Agent drafts could only be approved on another page.** Pending drafts in a conversation now show Approve & send / Edit / Decline inline.
4. **Two "Messages" page titles stacked on one screen** (synced email above the actual inbox). The inbox now comes first, and read-only email is a labeled subsection.
5. **Two vocabularies for the same places.** The signed-in nav said Communications / Operations / Scheduling / Finance / Management / Integrations. Page titles and the sample said Messages / To-do / Calendar / Money / Manager / Apps. Both now use the page names.
6. **Customers.** I first promoted Customers to the main navigation. I reversed that after the v1 definition (§0): the CRM stays in the background. Customer context now appears inside each decision, and customer search opens a one-customer view (sample: `/preview/customers`). Customers is no longer a destination in the navigation.
7. **Onboarding asked the same question twice** ("What does your business do?" in sign-up and again in onboarding). It also spent two of seven steps on a "personal AI assistant" with options the screen itself said weren't available. Onboarding is now 5 steps, the repeated question says it was saved and can be edited, and sign-up suggests the device timezone instead of asking the owner to type an IANA name.

## 5. Critique as a business owner

**Keep**
- Decisions with their reason, a proposed action and the consequence ("Approve 2:30 PM & send"). This is the core of the product.
- Honest status language ("Not sent", "This channel does not report whether it was read"). Owners will trust that.
- One shared customer record that agents and people both use.
- Approval → durable job → receipt architecture, idempotency and immutable history.

**Change**
- **The decision is the unit, not the page.** A decision should look and work the same on Today, in the customer's record and in the thread. Today the sample's best interactions exist only on Today, and "Decide on Today" links send the owner away from the context.
- **Today needs one count and one queue.** The sample says "4 decisions need you" above a queue labeled "Next up 6", because invoices and reports are mixed in. Separate *decide* (needs me) from *know* (FYI).
- **Manager should be a command bar, not a page.** "Ask or do anything" belongs on every screen (⌘K / a bottom bar on mobile), with answers and proposed actions shown in place.
- **Apps must not dead-end.** If a provider isn't configured, hide it or offer a working alternative. Never ask a solo owner to "ask your administrator."
- **Onboarding should end with something running.** Today it ends with "Your current permissions are unchanged." It should end with "Meridian is watching your inbox and calendar. Here is the first thing it found."

**Remove from the owner product** (move or freeze)
- Partner portal, agency/white-label billing and branding, platform control room, the `northstar_crm` second CRM, the test center, "Simple view" (a duplicate of Today), the personal-assistant preference and the floating "Personal assistant" button that covers content. Keep operator tooling, but outside the owner's product and build.

**Add**
- Two-way email and SMS from Meridian, plus calls (missed-call text-back, voicemail transcription, call log on the customer).
- Real calendar actions in the product: book, reschedule, cancel, block time.
- Money actions: create and send invoices or quotes, payment links, approved reminders, receipt reconciliation.
- Jobs and projects with staff assignment, and a staff view.
- A **Done** ledger: every action Meridian or a person took, with what was sent, to whom, the provider receipt, and undo where possible.
- Earned autonomy: Meridian proposes giving agents more freedom based on the owner's own approval history.

## 6. The best version of Meridian

**Interaction model: Stream + Context + Command.**

- **Stream (center).** A live, prioritized feed of *things that need the owner* (decisions) and, collapsed below, *things that happened* (receipts). Every card has the same anatomy: what happened, the essential facts, the proposed action, its consequence, and **Approve · Edit · Delegate · Decline**. Cards update as the world changes (a customer replies, a slot gets taken) instead of going stale.
- **Context (right pane).** Selecting any card, message, event or invoice opens the customer or job behind it: conversation, appointments, money, open work and what agents did. Context comes from selection, not from more panels on the page.
- **Command (everywhere).** One input to search, ask ("who owes me money?") or instruct ("move Jayden to Monday and let him know"). Results are cards in the same stream, so asking and approving work the same way.
- **Full views (quiet, secondary)** remain for owners who want to browse: Messages, Calendar, Money, To-do. Each is the same records in a familiar layout (inbox, calendar grid, invoice list). Agents and Apps sit under "Behind the scenes". There is no CRM screen in the navigation.

A first-time owner sees Today with three cards and a search box. A complex business sees the same layout with more cards, filters, staff and delegated authority. The concept doesn't change as the business grows.

## 7. Operating model

**Agents do automatically (no approval):** read and organize everything connected. They match messages to customers, summarize threads, detect intents (booking, quote, complaint, payment), draft replies, find open slots, flag overdue invoices and missed calls, keep records current, and prepare the morning and evening summary. None of this changes anything outside Meridian.

**Agents act on their own only within explicit authority** set per *action type × channel*, with limits:

| Level | Meaning |
|---|---|
| Off | Agent does nothing in this area |
| Watch | Agent observes and reports |
| Draft | Agent prepares; owner sends |
| Ask me | Agent prepares; owner approves; Meridian sends |
| Auto within limits | Agent acts, e.g. "confirmations to existing customers", "reminders under $500", "business hours only"; owner sees a receipt |

New businesses start at **Ask me** for messages and bookings and **Draft** for money. After the owner approves 15–20 of one kind of action without edits, Meridian offers: "You've approved 20 appointment confirmations unchanged. Let me send these automatically?" Autonomy is earned and can be revoked in one tap. A global pause stops all agent actions instantly. A person's own messages are never blocked by agent authority.

**Always needs a person:** money leaving the business, discounts or refunds, contracts, first contact with a new channel, anything to an opted-out or unverified person, and anything the agent is unsure about.

**How the owner starts work:** the command bar (search, ask, instruct), replying in any thread, the "+" on any department, or acting on a customer record. All of it runs through the same approval and receipt path as agent work.

**Context without clutter:** cards show only facts that bear on the decision (the requested time, the conflict, the customer's history in one line). Everything else is one click away in the context pane. No dashboards of metrics the owner didn't ask for; the pulse metric earns its place only when it changes.

**Confirmation and tracking:** every action produces a receipt in the thread or record where it happened and in the Done ledger. The receipt shows what was sent or changed, to whom, when, the provider result (sent, delivered, failed, unconfirmed) and who authorized it. Failures come back to the stream as decisions ("Text to Jayden failed: wrong number. Try email?"). Nothing is silently retried twice.

## 8. Prioritized path to a dependable product

**Phase 0: Focus (1 week).** Freeze partner, agency, control and CRM-v2 surfaces out of the owner build. Pick one launch profile: solo service businesses (trades, studios, clinics) on Google Workspace with a phone number.

**Phase 1: The communication loop, live (3–4 weeks).** This makes Meridian useful every day.
1. Hosted deploy, Google OAuth app verification, and production Supabase. This is the gating item in `docs/46`.
2. Gmail two-way: read, reply, draft and send from the thread. Add an email adapter for `conversation.send`.
3. Business phone number via Twilio: SMS two-way, missed-call text-back, call log, voicemail transcription.
4. Website chat (done) and a website form intake.
5. Agents on by default at "Ask me": customer service drafts replies, scheduling proposes slots, and the sales agent drafts warm-lead follow-ups. The follow-up loop and its grouped card exist today. It needs an Anthropic key, a connected sending account and email set to "ask me first".
6. **Recycled leads and past customers.** The sales agent only considers *open* leads (new, contacted, qualified, quoted). Lost leads and past customers, the "recycled" list, are never picked up. Add a re-engagement pass with its own pacing: at most one touch per person per N weeks, never anyone who opted out, and replies routed back into the pane.
7. Done ledger and failure-to-decision routing. Unsent approved actions currently return to Today as separate "Agent blocked" rows; group them and give each a one-tap fix.
8. Onboarding ends with Gmail and calendar connected, a number provisioned, and the first real card on Today.

**Phase 2: Scheduling and money (3 weeks).** Real calendar book, reschedule and cancel from cards and the calendar grid (reuse the sample's inline calendar). Stripe: invoices, payment links, overdue reminders with approval, and payments reconciled to customers. Optional QuickBooks sync.

**Phase 3: Marketing in the background (3 weeks).** Review requests after completed jobs, a monthly newsletter drafted from real work, and seasonal win-back emails. Each arrives in the pane as one grouped "read, then send" decision, never as a campaign tool the owner has to operate. (Staff, assignment and delegation come after v1, since v1 is for solo owners.)

**Phase 4: Growth and autonomy (ongoing).** Review requests, simple campaigns, earned-autonomy suggestions, weekly owner review, and more providers (Outlook, Square, Jobber, HubSpot) based on customer demand.

**Dependability bar for every phase:** a real provider receipt for every action, reconciliation for uncertain sends, alerting on failed jobs, and a pilot with 3–5 real businesses before the next phase.

## 9. Decisions made in this session

- **Owner-authored replies skip agent authority** (`lib/agents/person-authored.ts`). Authority delegates to agents; it shouldn't silence the owner. Safety checks on the conversation itself still apply.
- **The sidebar is one pane plus quiet secondary links.** It has three groups:
  - **Today** — the pane.
  - **Full views** — Messages, Calendar, Money, To-do.
  - **Behind the scenes** — Agents (formerly "Manager"), Apps.

  This replaces my earlier "Customers is a primary area" call. The CRM is reached only through customer search and the context inside decisions.
- **Agent outreach arrives as one grouped decision.** Drafted follow-ups to quiet leads appear as one card: "Follow up with N warm leads". It shows why each lead was chosen and what they asked before, with an editable draft for each, Send / Skip per lead, and Send all. The docket counts the group as one decision. Every send is still its own approval and delivery receipt.
- **The pane never invites an approval that will silently fail.** Before showing Send, Today checks the same account and permission rules that delivery runs. If nothing can go out (for example, no business email connected), the card says so, keeps the drafts, and offers "Connect email to send".
- **"Sent" means sent.** Approvals now report a delivery outcome (sent / not sent / uncertain), and screens only say "Sent" for a confirmed delivery.
- **One vocabulary:** navigation labels equal page titles.
- **The personal-assistant onboarding questions are out of the first-run path.** The data and settings stay, so saved progress is unaffected.
- **Not done yet, deliberately:** I didn't remove the partner, control or CRM surfaces in this pass. That's a product-scope call you should confirm (§5, "Remove").
