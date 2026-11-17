# Business workspace prototype

Built October 2–3, 2026. This is the implementation handoff for the single client product described in [the blueprint](34-client-product-blueprint.md). The earlier [readiness assessment](35-client-product-readiness-and-roadmap.md) is a pre-build snapshot; the status below supersedes its descriptions of the new workspace.

## Open it

With the local app running, open **http://localhost:3210/dev/prototype**. This development-only shortcut signs into the local platform test account and opens the explicitly fictional Fairway Golf Shop sandbox through the existing audited impersonation flow. The shortcut returns 404 in production. Ordinary business owners enter through normal sign-in and `/client`.

To restart on this machine:

```sh
colima start
./node_modules/.bin/supabase start -x analytics,vector,imgproxy,edge-runtime,studio
./node_modules/.bin/supabase migration up --local
npm run prototype:seed
npm run prototype
```

The existing `.env.local` must point at the local Supabase instance. Keep its values private. Do not run a database reset. `npm run prototype` starts both the app on port 3210 and the internal business scheduler. It does not drain external message or action queues. Stop it with Ctrl+C. The fixture script adds a separate test agency and test business, checks `is_test_account`, and uses stable record keys. Re-running it does not overwrite reviewed records or an edited business profile. It never seeds a live account. The golf shop is illustrative; no data was imported from the owner's actual golf business.

## What works

The home screen brings decisions, open jobs, recent work, and recommended capabilities together. The owner can use it without opening the detailed CRM. The existing agency branding and tenant boundaries remain in effect. Partner and platform CRM development remains deferred.

### Simple owner view on phones

For a local walkthrough, open **http://localhost:3210/dev/prototype?view=mobile**. This signs into the test identity, establishes the sample business context, and lands directly on the mobile view. Use this entry link in a new browser or after the one-hour preview session expires. The local access-denied screen also offers recovery links. These shortcuts remain unavailable in production.

The preview entry was checked from both a fresh browser and a platform session with no selected client. Both reached the mobile approvals screen. Login routing tests cover the mobile query parameter, and TypeScript and targeted lint passed for the fix. Existing role checks and production access restrictions remain enforced.

The separate, minimal owner experience lives at `/client/mobile` once a business is selected. Phone browsers entering `/client` are directed here automatically. Desktop users can choose **Simple view** from the workspace navigation. **Open full workspace** leads to `/client/business/home`, so owners can deliberately use the detailed interface on a phone as well.

- **Needs you:** a combined queue of business decisions and connected customer actions, with the actual content or fields to review and large approve/decline controls. Business approvals save a decision; connected-action approvals use the existing delivery queue. Each review explains the consequence.
- **Apps:** saved connections, readable live/preview/attention status, and verified provider destinations for supported app shortcuts. Unknown providers and website-chat connections point owners to their agency for help. No connection credentials or configuration are sent to this view.
- **Recent:** business events and recent customer decisions, including available delivery status. An approval is not presented as confirmed delivery.
- **Help:** agency branding and contact information, optional connection management, and the full workspace link.

The phone interface has three fixed bottom navigation buttons, larger touch targets, safe-area spacing, offline/error states, manual refresh, and refresh on return or every minute while visible. It does not load CRM contacts. It reads up to 50 pending items from each approval source, oldest first, with exact totals and an explicit indication when more remain. Business decisions retain revision checks and all writes use the existing authorization and tenant scope. Submitted content is not silently replaced while its review is open.

This increment is a mobile web interface. Native packaging, installable PWA behavior, and phone push notifications remain separate work. The local URL is accessible on this computer; hosted phone access still depends on the hosting recovery described below.

The mobile addition was verified locally on October 3: iPhone emulation redirected `/client` to `/client/mobile`; a campaign approval persisted and left the queue; a fictional appointment rejection persisted with zero external jobs queued; Recent showed both decisions; Apps displayed preview and attention states with the expected provider URLs; offline mode removed decision controls; and **Open full workspace** reached the detailed interface. No horizontal overflow or browser errors were observed. TypeScript, targeted ESLint, and all seven business-rule tests passed. The temporary appointment and connection fixtures used for verification were removed afterward. The existing sample campaign “Community equipment check-in” remains approved from the walkthrough.

Screenshots: [simple approvals](assets/business-prototype/simple-mobile-approvals.png), [decision review](assets/business-prototype/simple-mobile-decision.png), and [app shortcuts](assets/business-prototype/simple-mobile-apps.png). The app-shortcut screenshot uses the explicitly fictional temporary test connections. This mobile increment has not been deployed to the hosted preview below.

| Area | Working prototype behavior |
| --- | --- |
| Business setup | Describe the business; infer or choose its type; select goals; save services, audience, hours, rules, voice, and currency. Saved operating facts also update the existing assistant knowledge profile. |
| Recommendations | Rank 12 capability recipes using industry and goals. Explain each recommendation, inputs, steps, and expected output. Enable or pause internal capabilities. |
| Marketing | Create and edit campaign drafts, select an audience and channel, request approval, review fixed content, record a publication reference, and copy prepared text. |
| Sourcing | Save suppliers and buying opportunities with source links, condition notes, cost, shipping, fees, and expected resale. Calculate landed cost and estimated contribution; compare saved opportunities; prepare a linked purchase request. |
| Purchasing | Track inventory, costs, stock targets, and reorder points. Generate replenishment proposals while accounting for open requests. Approve a purchase, record an external order reference, and receive the full order into linked inventory. |
| Operations | Assign jobs, set priorities and due dates, keep checklists, move work through started/blocked/completed states, save procedures and knowledge, and record quotes and invoices. |
| Customers | Add and search shared CRM contacts. Open the existing detailed CRM and conversation interface when needed. Lead intake can maintain shared records for a business workspace even when its detailed CRM is hidden. |
| Approvals | Review business decisions in one hub, with access to the existing connected-action queue for customer messages and appointments. A submitted business record cannot be edited until declined and revised. |
| Capability runs | Save real drafts, briefs, and purchase proposals in the database. Product listing and invoice reminder drafts require one selected source record; unrelated invoices are excluded. |
| Daily work | Four internal recipes support a daily schedule through the existing jobs endpoint: sourcing comparison, purchasing planning, operations review, and owner briefing. Schedules are off in the sample business. |
| Records and access | Server-side authorization, scoped reads and writes, row-level security, restricted database functions, record revisions, replay protection, and a persisted activity trail. |

The ten internal recipes are marketing studio, sourcing analyst, purchasing planner, operations coordinator, listing assistant, follow-up assistant, document assistant, owner briefing, review/rebooking, and payment follow-up. Website concierge and booking coordinator route into the existing connected-app setup; they are not counted as newly verified live integrations.

## Suggested walkthrough

1. Open the sample business and its pending campaign decision. Read the actual content, approve or decline, and inspect the saved status.
2. Open Sourcing, review the sample opportunity's cost calculation, and prepare a purchase request. The request appears in Purchasing.
3. Open Purchasing. Create or review a purchase, submit it, approve it, and record an **example** order reference in this test account. Receive it only as a test; linked stock changes once. The initial grip purchase may already be received from verification.
4. Open Capabilities and run the sourcing analyst or owner briefing. The result is a saved briefing. Re-running the purchasing planner should not create duplicate restock requests while one is open.
5. Run Listing assistant and choose one inventory item, or Payment follow-up and choose one unpaid invoice. Review and edit the saved draft.
6. Open Operations, create a job, start it, mark a blocker, resume, and complete it. Add a procedure, quote, or invoice using the other tabs.
7. Open Business settings to change industry and priorities, then compare the recommendations. A new business starts with the description-led onboarding screen.

## Boundaries that are visible in the product

- **AI configuration:** the current local environment has no configured drafting provider. Templates and deterministic planning work. The existing tenant-accounted AI provider is wired for drafting when configured; output identifies AI failure/fallback. No live model call was verified in this build.
- **External execution:** a campaign approval does not publish content, and a purchase approval does not spend money. Recording an order, publication, or payment requires an external reference. These prototype actions record work completed elsewhere.
- **Sourcing:** calculations compare user-entered opportunities. No live marketplace scraping, verified sold-price research, supplier outreach, or autonomous sourcing was added.
- **Connections:** existing integration and chat/booking infrastructure remains accessible. Provider credentials, account permissions, operation mappings, installation, and live tests are still required. Instagram DMs, Messenger, and WhatsApp continuity were not implemented by adding recipe cards.
- **Mobile:** a dedicated simple owner view is available at `/client/mobile`, alongside the responsive full workspace. It is not a newly shipped native app, installable PWA, or push-notification system.
- **Purchasing:** receiving supports the complete recorded quantity. Partial deliveries, returns, cancellations after ordering, tax, currency conversion, and authoritative accounting/stock synchronization remain future work.
- **Money records:** quotes and invoices are operational records. Recording a paid status does not collect money or reconcile an accounting ledger.
- **Identity:** contact sharing uses the existing CRM; verified cross-channel identity resolution and conversation continuity remain separate work.
- **Detailed CRM:** customers share the existing CRM contact store. The new campaign, procurement, and operations records live in the business workspace; they are not yet mirrored into every legacy CRM campaign/task view. Normalize those relationships before presenting both interfaces as fully interchangeable.
- **Knowledge:** saved business settings feed existing assistant knowledge. General knowledge records are internal working documents; creating one does not automatically publish it as approved customer-facing knowledge.
- **Scale:** the prototype loads up to 1,000 business records and 200 contacts per workspace. Pagination, larger account performance, and full reporting remain production work.
- **Scheduling:** the local prototype launcher includes an internal worker. A hosted deployment must invoke the existing authenticated jobs endpoint; enabling a recipe alone does not provision that hosted worker. Scheduled work creates internal proposals only.

## Verification

- Full existing unit suite plus new business rules: **286 passing tests**.
- `scripts/verify-business-workspace.mjs`: database persistence, retry idempotency, competing approval attempts, immutable submitted content, external-order prerequisites, exactly-once stock receipt, authenticated/anonymous grants, and cross-tenant access checks passed.
- `scripts/verify-business-recipes.ts`: actual capability outputs, replay-safe replenishment, invoice isolation, selected-product validation, paused capabilities, and concurrent daily schedule claims passed.
- The Vercel production build, including TypeScript validation, passed. The protected preview's landing page returned 200, and the local-only prototype shortcut correctly returned 404 in production.
- Browser verification passed for the direct sandbox sign-in, owner home, purchase approval → recorded test order → receipt, and a sourcing capability run that opened its saved result. The database showed stock changing from 4 to 24 and the purchase reaching `received`.
- On a 390px phone viewport, the home, navigation menu, result dialog, campaign creation form, and approval dialog were exercised. A campaign was created and submitted through the UI; its reviewed text and approve/decline controls rendered correctly. No horizontal page overflow or browser JavaScript errors were observed in that walkthrough.
- The Operations area was loaded and its sample job was started through the browser.
- Targeted ESLint and the final local TypeScript check passed. The prototype launcher was verified to start both the web app and the internal scheduler. Its local Webpack mode required a runtime-specific import correction in the existing monitoring instrumentation; the final production build also passes with that correction.

Run the database journey checks with `npm run verify:business` against the local environment. They clean up their verification records. They must not run against a hosted database.

Saved walkthrough images: [desktop home](assets/business-prototype/business-desktop-home.png), [phone home](assets/business-prototype/business-mobile-home.png), [owner approval](assets/business-prototype/business-mobile-approval.png), and [sourcing result](assets/business-prototype/business-mobile-result.png).

## Hosting status

The existing Vercel integration reports `partner-platform-beta` (Supabase project `memyvqqlosoeqnpgxfvq`) as **Suspended**. Its public database/API hostname fails DNS lookup. The Vercel SSO recovery link returned **Unauthorized**, including a fresh attempt. Supabase management CLI authentication is unavailable in this session. The database must be resumed using an authenticated owner session before a functional hosted release can be verified.

The new additive migration is `supabase/migrations/20261003033634_business_workspace.sql`. It is applied locally. **It has not been applied to the suspended hosted database.** Do not promote a frontend that expects this schema until the hosted database is available and migrated. No live account data was seeded or modified during this build.

Build preview: https://partner-platform-82s2bg7qi-gking432s-projects.vercel.app. Deployment protection remains enabled. This is a build verification preview, not a working hosted client deployment while the database is suspended. The production alias was not promoted.

The local Supabase advisor command failed to establish its database connection even though the application and database journey tests connected successfully. Its failure is not a passing advisor result; repeat the advisor checks before production release.

## Next product increment

The [agent team build plan](38-agent-team-build-plan.md) now records the locally implemented coordinator foundation, sales follow-up and inventory/purchasing delegation, mobile attention cards, verification evidence, and remaining limits. It supersedes the historical prototype shortcut and advisor status above: normal entry uses actual account selection, and the advisor now runs locally with one existing `set_updated_at` warning. The new agent migration has not been applied to the suspended hosted database.

The October 3 Symphony clarification supersedes the earlier website-chat-first recommendation. Follow the [updated blueprint](34-client-product-blueprint.md#symphony-reference-and-current-build-priority) and [implementation handoff](10-codex-goal-prompt.md): actual business setup, guided activation, a shared work coordinator, scoped context, connected domain capabilities, proactive work, and phone oversight. Reuse the existing application and verify useful work across customer workflows and an internal business area. Keep the fictional development fixture out of the normal product entry flow. Add the remaining white-label commercial layer afterward.

The product prototype now spans the requested business areas. Production release still requires provider verification, hosted recovery, mobile notifications, usage/cost controls, billing and commercial validation, and deployment/backup/restore evidence. The commercial model and proposed agency prices remain in [document 33](33-business-model-and-pricing.md).
