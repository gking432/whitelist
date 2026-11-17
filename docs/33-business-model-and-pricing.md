# White label business model and pricing discussion

**Direction update, October 7:** this is a historical commercial discussion. The current offer is direct delivery through one company: a packaged solo-business app and custom implementations. White-label resale is deferred. These agency-tier price ideas do not set prices for either current offer. See the [revised build plan](38-agent-team-build-plan.md#current-direction--october-7-2026).

Recorded October 2, 2026. This document preserves the commercial discussion for later. The active development direction is the [client product blueprint](34-client-product-blueprint.md); building the agency CRM and platform-owner CRM is deferred.

## Who buys and who uses the product

The customer buying our software is an agency owner or entrepreneur. They market, package, implement, and sell it to small businesses in their area under their own brand. The business owner buys from a local provider who can understand their operation, connect their systems, and help when something goes wrong.

The intended offer includes full white-label resale rights: partners present the product as their own and choose their retail offer and pricing. The exact licensing terms, hosting options, and source-code rights remain to be defined; white-label resale must not silently be treated as a decision to transfer source-code ownership or support arbitrary self-hosted installations.

The local agency owns the client relationship and implementation service. We supply the software, reusable capabilities, updates, and technical escalation. The commercial promise is more time, leads, sales, and money for clients, supported by measurable results. Selling named “AI employees” is not the required positioning.

## Why this could be a viable business

The thesis is plausible: a trusted local operator can make automation useful for businesses that do not want to research tools, connect accounts, or maintain workflows themselves. Existing marketing agencies may already have the relationships and recurring service model to deliver it.

Our proposed advantage is the combination of local distribution, a simple business-owner experience, and repeatable implementation. It depends on execution. It is not yet evidence of willingness to pay, retention, profitable support, or a defensible market position.

The software needs to make each additional client easier to implement. If every installation requires our developers to build a custom system, the economics become those of bespoke services. Reusable business recipes, clear connection requirements, reliable execution, and visible outcomes are therefore commercial requirements as well as product requirements.

Competition does not invalidate the model. HighLevel currently advertises Agency Pro at $497/month with SaaS Mode, while usage charges and some capabilities cost extra. Vendasta explicitly offers software that partners can resell under their own brand. These establish comparable categories, not demand for our particular product. [HighLevel pricing](https://www.gohighlevel.com/pricing), [Vendasta partner program](https://www.vendasta.com/partners/).

## Pricing ideas discussed

These are hypotheses, not final plans or validated prices.

| Item | User proposal | What remains to decide |
| --- | --- | --- |
| Onboarding | About $1,000 once | Included implementation work, training, and first-client launch assistance |
| Middle tier | About $500/month | Number of active businesses, included support, usage allowances |
| Larger agency tier | About $1,500/month for an agency with 25 or more clients | Included capacity and additional-client pricing; avoid implying unlimited clients |
| Enterprise | Thousands per month | Commitments that justify the price and that we can actually deliver |

An earlier working option was $500 for up to 10 active client businesses. At full utilization, that is $50 per client. Charging $1,500 for exactly 25 included clients would be $60 per client, so the larger tier would need meaningful additional value or a different allowance. An illustrative alternative is $1,500 for 40 included clients, or $37.50 each at full utilization. Neither allowance is a decision.

Prefer gradual expansion charges over a sudden subscription jump for adding one client. Keep white-label rights central to the offer; use capacity, support, and delivered operational capabilities to distinguish tiers. Define what counts as an active client, including paused accounts, test accounts, and multiple locations.

AI inference, voice minutes, phone numbers, SMS, email, storage, and paid integration services need explicit allowances or separate usage billing. The business model must work for unusually active clients as well as average ones. Spending limits, alerts, and understandable invoices are part of the eventual offer.

### Illustrative agency economics

Assume, purely for illustration, that an agency sells each business a $500/month service:

| Agency | Retail revenue | Platform subscription | Remaining before other costs |
| --- | --- | --- | --- |
| 10 clients | $5,000/month | $500/month | $4,500/month |
| 25 clients | $12,500/month | $1,500/month | $11,000/month |

The remaining amount is not profit. It excludes usage, implementation labor, support, customer acquisition, payment fees, and overhead. The $500 retail price has not been validated with customers.

Track contribution per client as revenue less provider usage, allocated platform cost, implementation effort, and ongoing support. Measure agency onboarding time and platform support time separately so apparently healthy resale margins do not conceal expensive fulfillment.

## What onboarding and support should mean

The proposed onboarding fee could cover branding configuration, a supported service package, business rules, training, and help launching the first supported client. Any domain setup must match capabilities actually delivered. Unlimited custom integrations, migrations, and bespoke workflow development would require separate scope.

The intended support split is local agency support for the business, with platform engineering and product support for the agency. Partners need installation guides, troubleshooting information, escalation paths, and service expectations. Training should make partners capable of repeated delivery without developer intervention.

An enterprise offer should specify the support, governance, capacity, or contractual commitments it includes. Do not promise SSO, dedicated infrastructure, response-time guarantees, or a native branded mobile app until those are implemented and supported.

Current branding code supports names, logos, and colors. A complete commercial white-label experience still needs verification across domains, sign-in, messages, support links, receipts, and any app distribution. See the [readiness assessment](35-client-product-readiness-and-roadmap.md).

## Business onboarding concept and reference apps

The desired experience is: describe the business, receive useful recommendations, connect existing systems, confirm business rules, test the result, and enable it. A simple phone experience lets the business owner approve exceptions and inspect work. A detailed CRM can remain an optional view of the same underlying business data.

On October 3, the user identified the remembered app as Symphony. [Symphony by Wix](https://www.wix.com/symphony) is the matching product reference. The user directed us to build the underlying business-owner product first and add the white-label layer afterward. This changes implementation order, while preserving the intended local-agency resale model. Earlier alternatives were research leads, not the product the user meant. See the [updated client blueprint](34-client-product-blueprint.md#symphony-reference-and-current-build-priority).

The client product should not require the owner to buy a personal ChatGPT subscription as its activation step. Our application uses server-side model integrations; provider usage and the agency's own workplace AI subscriptions are separate purchasing decisions.

## What would validate the commercial model

A proposed pilot is three to five paying agencies that already serve small businesses. Begin with a small number of complete, repeatable workflows while keeping the architecture open to more industries.

Evidence to collect:

- An agency can explain and sell the offer under its own brand.
- It can activate another supported business using the setup flow and documentation.
- Clients receive useful outcomes such as faster responses, completed bookings, fewer missed follow-ups, or reduced administrative work.
- Provider costs and support effort leave room for both our margin and the agency's margin.
- Agencies and businesses continue using the product, renew, or expand after the initial novelty.

Revenue attribution must distinguish observed payments and bookings from estimates. No customer interviews, paid-pilot retention results, or validated margin study were established in this discussion.

## Current priority

Preserve this commercial model while building the actual product that the agency will sell. Partner sales pipelines, the platform owner's CRM, elaborate tier administration, and additional agency dashboards are deferred. Minimum tenancy, account access, branding, and support mechanisms remain necessary infrastructure.
