# Client product implementation handoff

Updated November 16, 2026. The product scope remains the [full business operating app](44-nightly-launch-roadmap.md). The [parallel development brief](45-parallel-build-brief.md) is the implementation assignment; [build progress](46-build-progress.md) holds current status and external gates. Account setup is not the global critical path for engineering.

## Paste into a new coding chat

```text
Work in /Users/gkn/partner-platform. Read AGENTS.md, docs/45-parallel-build-brief.md and docs/46-build-progress.md, then execute the brief.

You are the coordinating engineering lead. Use available subagents for bounded parallel implementation, integrate their changes and test the combined product. If delegation is unavailable, implement sequentially and say so. Preserve the existing working tree, including untracked code. Do not rebuild the deleted local Docker environment or create a fictional business.

Build the complete application toward docs/44-nightly-launch-roadmap.md. Start with the first integrated wave in the brief: shared business context, reviewed owner setup and enforced authority/manager controls. Continue feasible product work while live Google/database checks are pending; record those gates without claiming they passed.

Implement actual production paths and meaningful tests. Do not stop at another plan, new screens or an account-setup request. Keep progress/checkpoints in docs/46-build-progress.md and report completed capabilities, evidence and remaining external requirements concisely. After each coherent tested wave, commit and push the reviewed source to the existing authorized GitHub branch, excluding credentials and generated artifacts; verify the remote commit and include its link.
```

Open the new chat in this project with access to the current files. A separate checkout must include the uncommitted/untracked implementation; Git HEAD alone may omit current features. The prompt explicitly requests delegation; actual parallelism depends on the tools and limits of that session.

## Requirements preserved across sessions

Continue the existing project and reuse its shared records, CRM, connections, customer conversations, agents, action jobs and approvals. The business owner uses one minimal pane and manager chat; the CRM is optional detail. Phone and desktop share the same facts, and iOS/Android distribution remains part of the full product.

The application must perform supported business work, retain source/evidence, wait for human approval where required, stop stale work and distinguish a draft from a verified external result. Role names, prompts and catalog entries alone do not establish those capabilities.

Preserve customer identity and tenant boundaries, existing business data, working journeys and minimal administration/support. Do not edit `/Users/gkn/new` or the separate golf shop project. Do not expose secrets, bypass authorization, auto-seed a sample business, or publish private imported data in the separate public design preview.

The local Docker/Colima database was deliberately deleted to recover storage. Do not recreate it or blindly run prototype/database scripts. Respect the user's model-provider preference and applicable credential skills when actually changing or exercising AI APIs. Keep independent policy/context/UI/contract work moving when real DB/provider tests are blocked.

Custom enterprise workflow discovery/implementation and future white-label commercialization remain separate expansion tracks. New agency/platform CRMs, generic purchasing agents for every business, optional voice and universal provider coverage are not prerequisites for the core release. Preserve useful existing code for later modules.

Use the brief's acceptance levels and progress file. Complete source work, database integration, browser/device journeys and live-provider/store gates must be reported separately. Never infer production readiness from a green unit suite or a deployed preview alone.
