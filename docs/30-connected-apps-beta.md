# Connected apps beta

Implemented locally on September 4, 2026. This adds an embedded Zapier connection layer to the existing product; it does not complete every planned solution or certify every application. No production deployment or real provider pilot has occurred.

## Partner and client experience

Open **Client workspace → Integrations → Connect your existing apps**, or **Client portal → Apps and automations**.

1. Search the application catalog and authorize the client's account in the connection window.
2. Choose an installed solution, its business event, and an operation discovered from that app. Receive an app event, or prepare an app action after a selected workflow result.
3. Configure the app's input fields. Select fields load their choices from the provider; dependent fields can be refreshed as settings change.
4. Save the setup. For incoming events, create a sample in the source app. For outgoing actions, select a recent matching workflow run.
5. Map source fields to the solution or external action, inspect the sample, and test. This validates data without running workflows or making an external write.
6. Complete the client's existing beta acceptance and launch steps, then enable. Incoming events enter our durable workflow queue; outgoing actions enter the client's approval queue with their exact fields displayed.
7. Pause processing when needed. Already queued incoming events are held. Existing app-action approvals remain visible but cannot execute while their setup is paused. Actions already submitted externally continue to be checked for their result.

The sample remains in the provider inbox and can be processed after enabling. Local pause stops consumption, not provider collection; provider retention and usage still apply. Phone audio, live call coaching, and authoritative calendar availability continue to use direct integrations.

## Ownership of the solution

Zapier supplies app discovery, account authorization, event subscriptions and external actions. Our application owns tenant boundaries, the solution catalog, AI context and results, event normalization, workflow execution, approvals, the delivery outbox, and activity history.

An outbound setup binds to a specific installed workflow and business event. It can map `input` fields, the workflow `summary`, and structured `output` into a supported external action. Those mappings become concrete immutable fields on each approval. A retry cannot substitute a different account, operation or payload. Multiple approvals on one workflow are accounted for before its final status is settled.

The new provider is `zapier_embedded`. Existing direct connectors and the older workflow-deployment helper remain available separately.

## Platform activation requirements

The local project currently has none of the six required White Label settings configured. Obtain **Zapier White Label partner access**, rather than assuming an ordinary Zapier subscription enables these APIs. Nothing has been purchased or requested from Zapier automatically.

Provide Zapier with:

- Public HTTPS JWKS endpoint: `https://<platform-domain>/api/integrations/embedded/jwks`.
- The issuer you will set as `ZAPIER_WHITE_LABEL_ISSUER`; audience is `connect.zapier.com`.
- Claim mapping: `sub` is the authorizing person's immutable profile id; `org_id` is `<partner-id>:<client-id>`. This keeps client workspaces separate. Background execution reuses the same person identity; removing that person's qualifying membership stops provider access.
- The portal origins for the popup connection flow and any callback registrations required by your onboarding agreement. This implementation uses popup messages, not an unverified redirect callback.
- Access to app discovery, connections, Action Runs and Trigger Inbox APIs. Confirm exact scopes, task pricing, polling intervals, retention, limits and branding entitlement with Zapier.

Set the six server-only values documented in `.env.example`: client id, client secret, RSA private signing key (minimum 2048 bits), key id, issuer and scopes. Never place these in `NEXT_PUBLIC_*`. JWKS exposes only public key components. Previous public keys may be published during rotation.

Apply `20260904200000_embedded_app_connections.sql` before deploying this build. The required schema marker was advanced accordingly. Existing `/api/jobs/run` scheduling now includes inbox collection and external-result polling; monitor both worker results.

Official contracts checked during implementation: [partner onboarding](https://docs.zapier.com/white-label/implementation/partner-onboarding), [token exchange](https://docs.zapier.com/white-label/implementation/token-exchange), [connection flow](https://docs.zapier.com/white-label/implementation/connection-flow), [embedded actions](https://docs.zapier.com/white-label/use-cases/embedded-actions), [trigger inbox creation](https://docs.zapier.com/white-label/trigger-inbox/create-trigger-inbox), and [message consumption](https://docs.zapier.com/white-label/trigger-inbox/consuming-messages).

## Reliability and access controls

- Connection sessions expire after six minutes and are consumed once. Popup origin and source are checked in the browser; the server separately verifies account ownership, app identity, and expiration with Zapier.
- JWTs expire after five minutes. API tokens stay on the server; only resource-bound single-use Connect tokens reach the connection window.
- Metadata writes and session completion RPC are service-only. Server operations recheck authenticated client scope, role and support impersonation status. Composite foreign keys prevent cross-client connection bindings.
- Incoming payloads are mapped and checked, then committed to the existing encrypted queue before acknowledgment. Redelivery uses the same inbox/message idempotency key. Incomplete or possible-duplicate messages stop the setup for review.
- Approval resolution creates the external action job atomically. Each submission discovers a fresh provider action id and validates current fields. The approved app/account/action must match the current setup.
- A submitted action is `provider_pending`, not successful. A worker reads its final result. Unclear submissions and provider errors require reconciliation and are never automatically resubmitted. If the run reference was persisted before a crash, status can still be reconciled.
- Turning off a client, connection or setup stops new live execution. Outbound execution also checks the source workflow remains active and live.

## Verification evidence

Final checks passed: 278 tests, TypeScript, ESLint, the full database security/concurrency matrix, and the production build. The final simulated HTTP journey passed again after the interface fixes. Desktop and 390px mobile browser checks showed no application errors or page overflow.

- 10 new protocol tests: signed client identities, token exchange/resource binding, ownership validation, nested field mapping, invalid/required fields, durable acknowledgment order, duplicate redelivery, immutable approvals, fresh action ids, and ambiguous delivery.
- Database regression: `node scripts/verify-embedded-connections.mjs` against the disposable `beta_security_test` database verifies session replay rejection, sibling-client isolation, service-only writes and RPC, foreign-key scope, external approval immutability, and atomic outbox creation. Included in `verify:security:matrix`.
- Full application HTTP journey against disposable Supabase and simulated Zapier HTTP: authenticated discovery → connection → subscription → sample mapping → queue → existing workflow → client approval → outbox → submitted action → confirmed result. Actual application and database code executed; no real external account was authorized. Local evidence: `/tmp/embedded-http-journey-final.log`.
- Browser verification of the authenticated client page, app search and setup controls; screenshot `/tmp/embedded-connected-apps-final.png`. Real external OAuth consent remains unverified.

## Next release steps

1. Complete White Label onboarding, install server configuration in staging, and deploy the migration/build there.
2. Run real consenting test accounts through one inbound event and one approved outbound action. Prove expiration/reconnect, duplicate delivery, provider errors and polling latency, and inspect usage charges. This is an internal verification gate for a broad catalog, not a permanent limitation on what partners can sell.
3. Turn verified field mappings into reusable, centrally maintained installation recipes so agency partners increasingly choose outcomes rather than mapping fields themselves. The current UI is a general setup tool; it is not yet a fully automatic installer for every application.
4. Finish the remaining solution implementations (for example attribution writeback and advanced reactivation), then test them through the same bridge. An app's presence in the directory does not implement a missing workflow handler or expose all of that application's features.
5. Expand managed setup support for grouped/complex fields and large choice lists, add reconnect/subscription recovery UX and provider expiry webhooks, and add metered partner billing controls for external usage. Current subscription-creation uncertainty is explicitly escalated rather than retried blindly.
6. Build the later partner request → internal connector-development agent → owner-reviewed release process on this connection foundation.
