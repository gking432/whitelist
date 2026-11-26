# Simpler beta workspaces

UI review completed September 4, 2026. The existing beta implementation was committed and pushed first as `9cb99b2` on `codex/v1-scenario-lab`.

## What changed

- Platform owner, partner, and client portals share a consistent workspace frame, grouped navigation, clear current-page indicators, and a mobile menu. Owner pages retain their individual authorization checks inside the new shared layout.
- Partner navigation separates client delivery, offer setup, and agency management. Client workspaces keep the main delivery steps visible and put knowledge, approvals, reports, assistant, and settings in a secondary menu. Mobile users can choose any client section from a labeled selector.
- Client portals preserve partner names, logos, colors, and support details. Apps and launch navigation follow the existing role and permission checks. CRM navigation groups daily work, growth tools, and management. Its mobile dialog supports keyboard focus, Escape, and focus restoration.
- Connected apps now use three visible steps: connect an app, choose its task, and test before turning it on. Switching steps preserves form state. An untested or edited mapping cannot be enabled, and enabling also requires the client's live launch state. Existing pause and server-side approval rules remain in place.
- Business knowledge is grouped around the business and customer handling. Partners add questions and answers using ordinary fields instead of `Question :: Answer` syntax. The structured submission preserves line breaks and delimiter text; the server validates entries and still accepts the legacy form format. Appointment settings retain their values while collapsed, with readable AM/PM choices.
- Shared controls have more comfortable touch targets, visible keyboard focus, and mobile-friendly input sizes. Account diagnostics and connection details are available without dominating the everyday view.
- Labels explain test mode, preview-only runs, approvals, and connected-app actions. Delivery attention includes failed and uncertain deliveries instead of treating intentional previews as failures.
- A report hydration mismatch was fixed by explicitly setting the minimum fraction digits for compact currency. Server and browser now both render zero dollars as `$0`.

## Verification

- 278 automated tests passed; lint, TypeScript checking, production build, and `git diff --check` passed.
- Inspected 49 desktop routes across platform management, partner setup and delivery, client portal, and all 13 CRM sections. No page-width overflow was found. Reports and assistant were rechecked after the final fixes.
- Checked 14 mobile views at 390 × 844, including all three roles, setup, branding, knowledge, approvals, assistant, CRM, and reports. No horizontal page overflow or browser exceptions in the final pass.
- Verified the partner secondary menu renders above page content, the mobile menu closes after navigation, and the CRM mobile dialog closes with Escape and restores focus.
- Verified app setup keeps account/solution selections when moving between steps and disables enabling after a mapping edit.
- Saved a multiline FAQ containing `::` through the browser, checked the exact database value, and verified that collapsed appointment settings were retained.

The browser checks used an isolated local Supabase project and synthetic accounts. Expanded app behavior used the existing synthetic Zapier adapter; this review does not establish live-provider certification or production deployment readiness. No production deployment was performed.

## Next beta milestone

Activate the real provider accounts and run a supervised partner-to-client launch using a real phone route, calendar, and customer system. Have a nontechnical agency partner complete branding, client creation, connections, a test, and launch using only the interface. Record any step that still needs operator help, then finish those gaps before broad partner onboarding.
