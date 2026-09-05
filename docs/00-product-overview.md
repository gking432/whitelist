# 00 — What This Is (One-Pager)

**One line.** A multi-tenant platform that lets partners sell and operate
an AI operations layer for local service businesses — the AI answers the
phone, handles inbound leads, drafts and sends follow-ups, and books jobs
— running on top of the tools the business already uses, or a built-in
CRM.

## Who it's for (two audiences, one product)

- **Partners** — agencies, consultants, operators who want to launch an
  AI-implementation business without building software or becoming
  engineers. They pick a package, connect a client's tools, fill in the
  client's knowledge, and go live.
- **Their clients** — local service businesses (home services: HVAC,
  plumbing, roofing, electrical…) that bleed money on missed calls and
  slow lead follow-up.

## The core bet

A service business's operation is fragmented across a phone, a calendar,
texts, web forms, Google Business, and maybe a CRM they barely open. The
value is not another tool. It's an AI layer that **orchestrates across**
those tools and **does the customer-facing work** — deployed by a
nontechnical partner in an afternoon.

## What it does (built and running)

- Universal intake — phone, SMS, web form, website chat, Google Business
  — into one AI router.
- AI phone assistant (OpenAI Realtime) that answers, qualifies, collects
  details, and requests bookings.
- Lead analysis + approval-gated SMS/email first responses.
- Real calendar availability → approval-gated booking → confirmation.
- CRM sync (HubSpot, GoHighLevel, or signed outbound webhook), or a
  built-in CRM for clients without one.
- Per-client knowledge base the AI answers from, with never-invent
  guardrails.
- Staff assistant console, full audit trail, honest live / dry-run /
  sandbox modes.

## Why it is not repackaged n8n or generic templates

- **Opinionated vertical workflows** — how a lead *should* be handled —
  not a blank node editor the partner has to design.
- **A trust layer.** Every customer-facing action is human-approved and
  mode-gated; nothing sends by accident. Full audit + secret redaction.
  A template pile does not have this, and it is the hard part.
- **Partner operating infrastructure** — per-client encrypted
  credentials, tenant isolation (RLS), packages that gate capabilities,
  setup checklists.
- **Client differences are captured as structured knowledge (data), not
  custom code.** This is the single design decision that lets it scale.

## Why it survives CRMs adding their own AI

- The buyer does not live inside one CRM. The value is cross-tool
  orchestration plus doing work — answering the phone — that lives
  *outside* any CRM. A CRM's built-in AI does not pick up the phone at
  7pm.
- The moat is the **partner distribution channel** and the
  **trust/approval infrastructure**, not the raw automation. A CRM
  shipping an AI feature still gives a plumber no way to *buy and deploy*
  it.
- Whatever CRM the client uses becomes an integration, not a competitor.

## The discipline that keeps it software, not an agency

- **Controlled catalog** — a small set of strong systems across a few
  common stacks, not 100 tools for every business.
- **Configuration, not customization** — partners fill in forms
  (knowledge, hours, rules) and connect OAuth. Client differences never
  require code.
- **Packages + setup checklist** constrain the surface a partner touches.
- **Built-in CRM fallback** removes the most common "we can't deploy
  because they don't have X" blocker.

## What is deliberately NOT built (honesty)

Partner billing / usage pricing; the phone bridge for real carrier calls
(the AI phone assistant works in simulation today; live calls need a
SIP/Twilio bridge — docs/21); SSE push; appointment reschedule/cancel;
broad long-tail integrations beyond the controlled set.

## The strategic throughline

The winning version of this is **not** a horizontal "implementation OS for
any business system" — that framing is the agency trap, and it competes
with everyone. The winning version is a **focused vertical AI operations
layer, sold through partners, where client differences are structured
knowledge rather than custom builds.** Narrowness is both the moat and the
thing that keeps it a scalable software business.
