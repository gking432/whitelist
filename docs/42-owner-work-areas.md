# Owner work areas

The packaged app is organized around four things an owner does: Today, Messages, To-do, and Manager. Sales, marketing, and operations remain internal agent responsibilities and optional detailed tools.

## Navigation and presentation

The four destinations share the minimal white workspace and one collapsed Menu. Today starts with a short, left-aligned blue greeting/overview banner. Messages, invoices, appointments, and due work sit in their own sections below it; empty categories stay hidden. Menu lists the four areas first, then connections; older detailed tools sit behind More tools. No business, customer, connected app, or sample work is installed for the owner.

| Area | URL | Current behavior |
| --- | --- | --- |
| Today | `/client` | Compact left-aligned greeting and daily overview, with relevant work sections below; uses the same actions as To-do |
| Messages | `/client/messages` | Shared inbox with All, Needs me, Being handled, and Done; channel filter and search appear when there are conversations |
| To-do | `/client/todo` | Workspace actions, existing saved CRM tasks, and actual agent assignments; open/completed work, with human/agent filters when useful |
| Manager | `/client/manager` | Existing private owner/manager chat, supported reviews and delegation, and links to agent settings |

The old `/client/conversations?id=…` route redirects to Messages while preserving the selected thread.

## Messages

- Retains each channel and original conversation. A unified inbox does not silently merge customer identities or message histories.
- Needs me includes human handling, handoff, and pending approval. Closed conversations stay Done even if their mode is human.
- Being handled includes open agent-handled conversations that have not opted out.
- Filtering out the selected conversation hides its history until a matching thread is selected. Another customer's messages are never relabeled as the selected customer.
- Existing take-over, return-to-agents, recheck, close, draft-reply approval, and verified customer-link controls are retained.
- The inbox loads the most recent 100 conversations, plus a specifically requested older thread. Search and filters operate on that loaded set, with an explicit limit notice when truncated. Server-side pagination and exhaustive search are still separate work.
- Messages is a view over actually ingested business conversations. It is not a complete mirror of every personal email or every folder in a connected mailbox.

## To-do

New actions use the existing business-record mutation API, request deduplication, revision checks, goal links, and activity history. To-do and Today do not create competing task copies.

Existing `crm_tasks` can be completed or reopened from To-do. The new task-status API derives business scope from the authenticated portal, validates write access, and compares `updated_at` before saving. Concurrent or cross-business updates fail rather than reporting success on zero rows. Completion timestamps are recorded and cleared when reopened.

Agent assignments remain real `agent_work_items`; their statuses are read rather than inferred. Approval and conversation links open the existing source. Marking a human task complete does not claim an agent performed an external action.

The view currently loads up to 1,000 recent workspace records, 300 existing tasks, and 200 recent agent assignments, with truncation disclosed. It refreshes while visible every 30 seconds, except while a record is being reviewed or edited.

## Manager boundaries

This increment gives the existing chat the same minimal presentation and protects its refresh requests from overwriting a just-submitted response. It reuses the saved request/assignment history and existing execution system.

Agent setup is still required before chat can submit work. When no model is configured, the existing supported saved-record status requests and standard reviews are available after activation; general AI conversation still needs configuration. No provider/model or OAuth setup was performed in this increment.

Natural-language control changes such as “stop Instagram,” per-account pause policies, and persistent business-rule editing are not implemented by this UI increment. Settings retain the existing team controls. These chat commands must be backed by enforced saved settings before the manager can claim they succeeded.

## Verification

- TypeScript and targeted ESLint checks passed.
- Unit checks cover message handoff/approval/closed/opt-out classification, strict task mutation inputs, and the four owner routes.
- Local database verification covers persisted task completion/reopening, stale-write rejection, cross-business isolation, and read-only access rejection.
- Browser: navigated through all four areas; created an action in To-do, saw it on Today, completed it, and found it in Completed.
- Browser: completed and reopened an existing saved task through the new API.
- Browser: loaded disposable website/email threads, filtered Needs me, checked that another thread's history was absent, then marked a conversation done and found it in Done.
- Browser: confirmed Manager honestly shows the current unconfigured/paused setup state.

Disposable UI records, disabled test connections, and isolated database fixtures were removed after verification. No outbound messages or live provider actions were performed.

```sh
npm run typecheck
node --experimental-strip-types --test tests/owner-areas.test.ts
npx tsx --env-file-if-exists=.env.local scripts/verify-owner-areas.ts
```
