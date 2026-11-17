import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ensureProviderConnection } from "../lib/integrations/connect-provider";
import { startReadOnlyOAuth } from "../lib/connections/oauth";
import { readConnectedData } from "../lib/connections/data";
import {
  enqueueInitialConnectorSync,
  processConnectorSyncJobs,
} from "../lib/integrations/connectors/sync-runner";
import { encryptProviderCredentials } from "../lib/integrations/credentials";
import { verifyWorkspaceOAuthState } from "../lib/integrations/providers/workspace-oauth";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local verification only",
  );
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const check = <T>(r: { data: T; error: { message: string } | null }) => {
    if (r.error) throw new Error(r.error.message);
    return r.data!;
  };
  const partnerId = randomUUID(),
    clientId = randomUUID(),
    otherId = randomUUID();
  const scope = { partnerId, clientId };
  const originalFetch = globalThis.fetch;
  const beforeId = process.env.GOOGLE_OAUTH_CLIENT_ID,
    beforeSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "disposable-verification";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "disposable-verification";
  const {
    data: { user },
    error: userError,
  } = await admin.auth.admin.createUser({
    email: `connection-verify-${randomUUID()}@example.test`,
    password: randomUUID(),
    email_confirm: true,
  });
  assert.equal(userError, null);
  assert.ok(user);
  try {
    check(
      await admin.from("partners").insert({
        id: partnerId,
        name: "Disposable connection verification",
        slug: `verify-${partnerId}`,
        is_test_account: true,
        status: "active",
      }),
    );
    check(
      await admin.from("client_businesses").insert(
        [clientId, otherId].map((id) => ({
          id,
          partner_id: partnerId,
          name: "Disposable verification",
          slug: `verify-${id}`,
          is_test_account: true,
          status: "active",
          crm_operating_mode: "primary_crm",
        })),
      ),
    );
    const auth = await startReadOnlyOAuth(admin, scope, user.id),
      authUrl = new URL(auth.url);
    const state = verifyWorkspaceOAuthState(authUrl.searchParams.get("state")!);
    assert.ok(state?.readOnlyAttemptId);
    const attempt = check(
      await admin
        .from("business_connection_oauth_attempts")
        .select("*")
        .eq("id", state.readOnlyAttemptId)
        .single(),
    );
    assert.equal(attempt.actor_id, user.id);
    assert.ok(attempt.encrypted_verifier);
    assert.notEqual(attempt.cookie_hash, auth.cookie);
    const stored = encryptProviderCredentials({
      clientId: "fixture",
      clientSecret: "fixture",
      refreshToken: "fixture",
      accessMode: "read_only",
    });
    const finish = {
      p_attempt: attempt.id,
      p_encrypted: stored.encrypted_value,
      p_last_four: stored.last_four,
      p_account_id: "fixture-account",
      p_account_name: "owner@example.test",
    };
    assert.ok(
      (await admin.rpc("finish_readonly_workspace_oauth", finish)).error,
      "unconsumed attempt is rejected",
    );
    check(
      await admin
        .from("business_connection_oauth_attempts")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", attempt.id),
    );
    check(await admin.rpc("finish_readonly_workspace_oauth", finish));
    assert.ok(
      (await admin.rpc("finish_readonly_workspace_oauth", finish)).error,
      "replay is rejected",
    );
    const connId = state.connectionId;
    await enqueueInitialConnectorSync(admin, {
      ...scope,
      connectionId: connId,
      providerKey: "google_workspace",
    });
    const queued = check(
      await admin
        .from("integration_sync_jobs")
        .select("object_type")
        .eq("connection_id", connId),
    );
    assert.deepEqual(queued.map((j) => j.object_type).sort(), [
      "appointment",
      "message",
    ]);
    const agentConnection = await ensureProviderConnection(admin, {...scope,createdBy:user.id}, 'google_workspace');
    assert.notEqual(agentConnection,connId,'assistant setup must not adopt the read-only connection');
    check(await admin.from('integration_connections').delete().eq('id',agentConnection));
    let round = 0;
    globalThis.fetch = async (input, init) => {
      const u = new URL(String(input));
      if (u.hostname === "oauth2.googleapis.com")
        return Response.json({ access_token: "fixture" });
      if (u.hostname === "gmail.googleapis.com") {
        if (u.pathname.endsWith("/profile"))
          return Response.json({ historyId: "100" });
        if (u.pathname.endsWith("/messages")) {
          assert.equal(
            u.searchParams.get("q"),
            "newer_than:30d -in:spam -in:trash -in:drafts",
          );
          return Response.json({
            messages: [
              { id: "mail1", threadId: "thread1" },
              { id: "vanished", threadId: "thread2" },
            ],
          });
        }
        if (u.pathname.endsWith("/history"))
          return Response.json({
            history: [
              {
                messagesDeleted: [
                  { message: { id: "mail1", threadId: "thread1" } },
                ],
              },
            ],
            historyId: "101",
          });
        if (u.pathname.endsWith("/vanished"))
          return new Response("{}", { status: 404 });
        return Response.json({
          id: "mail1",
          threadId: "thread1",
          internalDate: String(Date.now()),
          snippet: "Question about availability",
          labelIds: ["INBOX", "UNREAD"],
          payload: {
            headers: [
              { name: "From", value: "Customer <customer@example.test>" },
              { name: "Subject", value: "Appointment question" },
            ],
          },
        });
      }
      if (
        u.hostname === "www.googleapis.com" &&
        u.pathname.includes("/calendar/")
      ) {
        if (round === 0)
          assert.ok(
            u.searchParams.has("timeMin") && u.searchParams.has("timeMax"),
            "first snapshot has a bounded rolling window",
          );
        return Response.json({
          items: [
            {
              id: "event1",
              summary: round ? "Updated visit" : "Client visit",
              start: { dateTime: new Date(Date.now() + 3600000).toISOString() },
              end: { dateTime: new Date(Date.now() + 7200000).toISOString() },
              htmlLink:
                "https://calendar.google.com/calendar/event?eid=fixture",
            },
          ],
          nextSyncToken: "calendar-checkpoint",
        });
      }
      return originalFetch(input, init);
    };
    const imported = await processConnectorSyncJobs(4, {
      connectionId: connId,
      readOnly: true,
    });
    assert.equal(imported.succeeded, 2);
    let data = await readConnectedData(admin, scope);
    assert.deepEqual(data.errors, []);
    assert.equal(data.messages.length, 1);
    assert.equal(data.appointments.length, 1);
    assert.equal(data.messages[0].unread, true);
    assert.ok(data.apps[0].lastSyncedAt);
    assert.equal(
      (await readConnectedData(admin, { partnerId, clientId: otherId }))
        .messages.length,
      0,
      "another business cannot see imported records",
    );
    for (const table of [
      "crm_contacts",
      "crm_appointments",
      "business_conversations",
      "agent_work_items",
      "integration_events",
    ]) {
      const rows = check(
        await admin.from(table).select("id").eq("client_id", clientId),
      );
      assert.equal(rows.length, 0, `${table} untouched`);
    }
    round = 1;
    check(
      await admin
        .from("integration_sync_jobs")
        .update({ scheduled_for: new Date().toISOString() })
        .eq("connection_id", connId)
        .eq("status", "queued"),
    );
    await processConnectorSyncJobs(4, { connectionId: connId, readOnly: true });
    data = await readConnectedData(admin, scope);
    assert.equal(data.messages.length, 0, "provider deletions disappear");
    assert.equal(
      data.appointments[0].title,
      "Updated visit",
      "edits update the same event",
    );
    assert.equal(
      check(
        await admin
          .from("integration_canonical_records")
          .select("id")
          .eq("connection_id", connId)
          .eq("object_type", "appointment"),
      ).length,
      1,
      "repeated sync deduplicates",
    );
    assert.ok(
      (
        await admin.rpc("manage_readonly_workspace_connection", {
          p_partner: partnerId,
          p_client: otherId,
          p_connection: connId,
          p_action: "disconnect",
        })
      ).error,
      "wrong scope cannot disconnect",
    );
    check(
      await admin.rpc("manage_readonly_workspace_connection", {
        p_partner: partnerId,
        p_client: clientId,
        p_connection: connId,
        p_action: "pause",
      }),
    );
    assert.equal((await readConnectedData(admin, scope)).apps[0].paused, true);
    assert.equal(
      check(
        await admin
          .from("integration_sync_jobs")
          .select("id")
          .eq("connection_id", connId)
          .eq("status", "queued"),
      ).length,
      0,
      "pause cancels pending polling",
    );
    const reconnect = await startReadOnlyOAuth(admin, scope, user.id);
    const reconnectState = verifyWorkspaceOAuthState(
      new URL(reconnect.url).searchParams.get("state")!,
    )!;
    check(
      await admin
        .from("business_connection_oauth_attempts")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", reconnectState.readOnlyAttemptId),
    );
    assert.ok(
      (
        await admin.rpc("finish_readonly_workspace_oauth", {
          ...finish,
          p_attempt: reconnectState.readOnlyAttemptId,
          p_account_id: "different-account",
        })
      ).error,
      "different account cannot overwrite an existing connection",
    );
    check(
      await admin.rpc("manage_readonly_workspace_connection", {
        p_partner: partnerId,
        p_client: clientId,
        p_connection: connId,
        p_action: "disconnect",
      }),
    );
    assert.equal(
      check(
        await admin
          .from("integration_secrets")
          .select("id")
          .eq("connection_id", connId),
      ).length,
      0,
    );
    assert.equal(
      check(
        await admin
          .from("integration_canonical_records")
          .select("id")
          .eq("connection_id", connId),
      ).length,
      0,
    );
    console.log(
      "PASS: OAuth single use, account binding, scoped real database import, read-only boundary, edits/deletes/dedupe, pause/disconnect. Provider responses mocked; no live Google authorization claimed.",
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (beforeId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = beforeId;
    if (beforeSecret === undefined)
      delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    else process.env.GOOGLE_OAUTH_CLIENT_SECRET = beforeSecret;
    check(await admin.from("partners").delete().eq("id", partnerId));
    await admin.auth.admin.deleteUser(user.id);
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
