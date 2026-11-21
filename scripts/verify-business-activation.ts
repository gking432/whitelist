import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  applyActivation,
  readActivation,
  readActivationPlan,
  probeWorkspace,
} from "../lib/activation/service";
import {
  encryptProviderCredentials,
  readProviderCredentials,
} from "../lib/integrations/credentials";
import { ensureProviderConnection } from "../lib/integrations/connect-provider";
import { enqueueWorkspaceInquiry } from "../lib/integrations/inbound/workspace-inbox";
import { processInboundEventJobs } from "../lib/integrations/inbound/queue";
import { findConnectionByWidgetKey } from "../lib/chat/widget";
import type { CanonicalRecord } from "../lib/integrations/connectors/types";
import type { WorkspaceCredentials } from "../lib/integrations/providers/workspace-oauth";
import { respondToConversation } from "../lib/conversations/agent";
import type { generateStructured } from "../lib/ai/provider";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local verification only",
  );
  delete process.env.ANTHROPIC_API_KEY;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const login = await owner.auth.signInWithPassword({
    email: "client@northstar.test",
    password: "local-password-change-me",
  });
  if (login.error) throw login.error;
  const actorId = login.data.user.id,
    partnerId = randomUUID(),
    clientId = randomUUID(),
    otherId = randomUUID(),
    scope = { partnerId, clientId };
  const choices = {
    status: "active",
    inquiries: true,
    bookings: true,
    website: true,
    email: true,
    instagram: false,
    sms: false,
    workspace_provider: "google_workspace",
    booking_start_hour: 9,
    booking_end_hour: 17,
    booking_minutes: 60,
    booking_weekdays: [1, 2, 3, 4, 5],
    timezone: "America/Chicago",
  };
  const unwrap = <T>(r: {
    data: T;
    error: { message: string } | null;
  }): NonNullable<T> => {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  };
  const connection = async (id: string) =>
    unwrap(
      await admin
        .from("integration_connections")
        .select("*")
        .eq("id", id)
        .single(),
    );
  unwrap(
    await admin.from("partners").insert({
      id: partnerId,
      name: "Activation verification",
      slug: `verify-${partnerId}`,
      is_test_account: true,
      status: "active",
    }),
  );
  try {
    unwrap(
      await admin.from("client_businesses").insert(
        [clientId, otherId].map((id) => ({
          id,
          partner_id: partnerId,
          name: "Temporary activation verification",
          slug: `verify-${id}`,
          is_test_account: true,
          status: "active",
          client_portal_enabled: true,
        })),
      ),
    );
    unwrap(
      await admin.from("memberships").insert({
        user_id: actorId,
        partner_id: partnerId,
        client_id: clientId,
        role: "client_owner",
        status: "active",
      }),
    );
    unwrap(
      await admin.from("business_workspace_profiles").insert({
        partner_id: partnerId,
        client_id: clientId,
        profile: {
          description: "Verification fixture",
          services: "Appointment verification",
          industry: "fitness",
        },
      }),
    );
    let plan = (await applyActivation(admin, scope, 0, choices))!;
    assert.equal(plan.revision, 1);
    let snap = await readActivation(admin, scope, true);
    assert.equal(snap.status, "needs_attention");
    assert.ok(snap.widgetUrl);
    const widgetKey = new URL(snap.widgetUrl!).pathname.split("/").pop()!;
    assert.ok(await findConnectionByWidgetKey(admin, widgetKey));
    await assert.rejects(() => applyActivation(admin, scope, 0, choices));
    plan = (await applyActivation(admin, scope, 1, choices))!;
    assert.equal(
      (await readActivation(admin, scope, true)).widgetUrl,
      snap.widgetUrl,
      "Saving must not duplicate or rotate a widget",
    );
    assert.ok(
      (await owner.from("business_agent_activation").select("*")).error,
      "Owner must use scoped API",
    );
    assert.ok(
      (
        await owner.rpc("apply_business_activation", {
          p_partner: partnerId,
          p_client: clientId,
          p_revision: plan.revision,
          p_choices: choices,
          p_widget_key: widgetKey,
        })
      ).error,
      "RPC must be service-only",
    );
    const connId = await ensureProviderConnection(
      admin,
      { ...scope, createdBy: actorId },
      "google_workspace",
    );
    await applyActivation(admin, scope, plan.revision, null);
    plan = (await readActivationPlan(admin, scope))!;
    assert.equal(plan.workspace_connection_id, connId);
    const foreign = await ensureProviderConnection(
      admin,
      { partnerId, clientId: otherId, createdBy: actorId },
      "google_workspace",
    );
    assert.ok(
      (
        await admin
          .from("business_agent_activation")
          .update({ workspace_connection_id: foreign })
          .eq("client_id", clientId)
      ).error,
      "Composite FK prevents cross-business credentials",
    );
    const credentials = {
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      refreshToken: "fixture-refresh",
      scope:
        "openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar",
    };
    const stored = encryptProviderCredentials(credentials);
    const makeAttempt = async (revision: number, consumed = true) =>
      unwrap(
        await admin
          .from("business_activation_oauth_attempts")
          .insert({
            partner_id: partnerId,
            client_id: clientId,
            connection_id: connId,
            actor_id: actorId,
            provider_key: "google_workspace",
            plan_revision: revision,
            cookie_hash: "fixture-hash",
            encrypted_verifier: "fixture-encrypted",
            consumed_at: consumed ? new Date().toISOString() : null,
            expires_at: new Date(Date.now() + 900000).toISOString(),
          })
          .select("id")
          .single(),
      ).id;
    const finish = (id: string, email = true) =>
      admin.rpc("finish_activation_oauth", {
        p_attempt: id,
        p_encrypted: stored.encrypted_value,
        p_last_four: stored.last_four,
        p_account_id: "fixture-account",
        p_account_name: "owner@example.com",
        p_email: email,
        p_calendar: true,
      });
    assert.ok(
      (await finish(await makeAttempt(plan.revision, false))).error,
      "Unconsumed OAuth cannot complete",
    );
    assert.ok(
      (await finish(await makeAttempt(plan.revision - 1))).error,
      "Stale callback cannot enable changed setup",
    );
    const partial = await makeAttempt(plan.revision);
    assert.ok((await finish(partial, false)).error, "Partial grants roll back");
    assert.equal(await readProviderCredentials(admin, connId), null);
    const accepted = await makeAttempt(plan.revision);
    unwrap(
      await admin.from("integration_sync_states").insert({
        partner_id: partnerId,
        client_id: clientId,
        connection_id: connId,
        stream_key: "message",
        status: "paused",
        last_error: "Fixture revoked authorization",
      }),
    );
    unwrap(await finish(accepted));
    assert.equal(
      unwrap(
        await admin
          .from("integration_sync_states")
          .select("status")
          .eq("connection_id", connId)
          .eq("stream_key", "message")
          .single(),
      ).status,
      "idle",
      "Authorization restores paused inbox sync",
    );
    await applyActivation(admin, scope, plan.revision, null);
    const streams = unwrap(
      await admin
        .from("integration_sync_jobs")
        .select("object_type")
        .eq("connection_id", connId),
    );
    assert.deepEqual(
      streams.map((s) => s.object_type).sort(),
      ["appointment", "message"],
      "Only selected services receive sync jobs",
    );
    assert.ok(
      (await finish(accepted)).error,
      "Completed attempts cannot replay",
    );
    assert.equal(
      (await readProviderCredentials<WorkspaceCredentials>(admin, connId))
        ?.refreshToken,
      "fixture-refresh",
    );
    assert.equal((await connection(connId)).runtime_mode, "live");
    const cfg = (await connection(connId)).config;
    const record: CanonicalRecord = {
      objectType: "message",
      externalId: "fixture-message-1",
      // Use provider event time after the DB activation clock, independent of local clock skew.
      updatedAt: new Date(
        Math.max(
          Date.now(),
          Date.parse(cfg.conversation_intake_enabled_at) + 1000,
        ),
      ).toISOString(),
      data: {
        sender: "customer@example.com",
        body: "Can I book a consultation?",
        inbound: true,
        automated: false,
        has_attachments: false,
      },
      source: {},
    };
    const intake = {
      ...scope,
      connectionId: connId,
      providerKey: "google_workspace",
      config: cfg,
      runtimeMode: "live",
      record,
    };
    assert.equal(
      await enqueueWorkspaceInquiry(admin, {
        ...intake,
        record: { ...record, updatedAt: "2020-01-01T00:00:00Z" },
      }),
      null,
    );
    const event = await enqueueWorkspaceInquiry(admin, intake);
    assert.ok(
      event?.eventId,
      JSON.stringify({
        enabled: cfg.conversation_intake_enabled,
        cutoff: cfg.conversation_intake_enabled_at,
        received: record.updatedAt,
        now: new Date().toISOString(),
      }),
    );
    assert.equal(
      (await enqueueWorkspaceInquiry(admin, intake))?.duplicate,
      true,
    );
    const processed = await processInboundEventJobs(admin, 1, event.eventId);
    assert.equal(processed.failed, 0);
    const conversation = unwrap(
      await admin
        .from("business_conversations")
        .select("id,contact_id,channel,external_thread_id")
        .eq("client_id", clientId)
        .single(),
    );
    assert.equal(conversation.channel, "email");
    assert.equal(conversation.external_thread_id, "customer@example.com");
    assert.ok(conversation.contact_id);
    assert.equal(
      unwrap(
        await admin
          .from("agent_work_items")
          .select("kind")
          .eq("client_id", clientId)
          .single(),
      ).kind,
      "conversation_reply",
    );
    assert.equal(
      unwrap(
        await admin
          .from("business_conversation_messages")
          .select("body")
          .eq("conversation_id", conversation.id)
          .single(),
      ).body,
      record.data.body,
    );
    plan = (await applyActivation(admin, scope, plan.revision, {
      ...choices,
      inquiries: false,
    }))!;
    const claimed = unwrap(
      await admin.rpc("claim_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
      }),
    )[0];
    assert.ok(claimed, "The newly imported email should be durable agent work");
    await respondToConversation(admin, claimed, {
      isConfigured: () => true,
      generate: (async () => ({
        data: {
          topic: "inquiry",
          customer_details: { name: null, email: null, phone: null },
          department: "customer_service",
          action: "reply",
          summary: "General inquiry",
          next_action: "Reply",
          reply: "Fixture response must not be sent",
          selected_slot: null,
          preference: "",
        },
      })) as unknown as typeof generateStructured,
    });
    assert.equal(
      unwrap(
        await admin
          .from("agent_work_items")
          .select("status")
          .eq("id", claimed.id)
          .single(),
      ).status,
      "blocked",
    );
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("id")
          .eq("client_id", clientId),
      ).length,
      0,
      "Booking-only setup must not prepare a general reply",
    );
    plan = (await applyActivation(admin, scope, plan.revision, {
      ...choices,
      status: "paused",
    }))!;
    assert.equal((await connection(connId)).runtime_mode, "paused");
    assert.equal(await findConnectionByWidgetKey(admin, widgetKey), null);
    assert.equal((await readActivation(admin, scope, true)).status, "paused");
    const pausedAttempt = await makeAttempt(plan.revision);
    assert.ok(
      (await finish(pausedAttempt)).error,
      "OAuth may never unpause a team",
    );
    plan = (await applyActivation(admin, scope, plan.revision, {
      ...choices,
      email: false,
    }))!;
    assert.equal(
      (await connection(connId)).config.conversation_intake_enabled,
      false,
    );
    plan = (await applyActivation(admin, scope, plan.revision, choices))!;
    assert.ok(
      Date.parse(
        (await connection(connId)).config.conversation_intake_enabled_at,
      ) >= Date.parse(cfg.conversation_intake_enabled_at),
    );
    const originalFetch = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = async (input, init) => {
      const requestUrl = String(input);
      calls.push(requestUrl);
      assert.ok(
        !requestUrl.includes("send"),
        "Access probes never send messages",
      );
      if (requestUrl === "https://oauth2.googleapis.com/token")
        return Response.json({ access_token: "fixture-access" });
      if (requestUrl.includes("userinfo"))
        return Response.json({ id: "fixture", email: "owner@example.com" });
      if (requestUrl.endsWith("/profile"))
        return Response.json({ emailAddress: "owner@example.com" });
      if (requestUrl.endsWith("/freeBusy")) {
        assert.equal(init?.method, "POST");
        return Response.json({ calendars: { primary: { busy: [] } } });
      }
      throw new Error("Unexpected external request in fixture");
    };
    try {
      assert.deepEqual(await probeWorkspace("google_workspace", credentials), {
        email: true,
        calendar: true,
        accountId: "fixture",
        accountName: "owner@example.com",
      });
      assert.ok(
        calls.some((c) => c.endsWith("/profile")) &&
          calls.some((c) => c.endsWith("/freeBusy")),
      );
      assert.equal(
        (
          await probeWorkspace("google_workspace", {
            ...credentials,
            scope: "openid email profile",
          })
        ).email,
        false,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    unwrap(
      await admin.rpc("record_activation_workspace_check", {
        p_partner: partnerId,
        p_client: clientId,
        p_revision: plan.revision,
        p_connection: connId,
        p_email: false,
        p_calendar: false,
      }),
    );
    assert.equal(
      (await connection(connId)).runtime_mode,
      "paused",
      "Revoked access blocks pending actions",
    );
    snap = await readActivation(admin, scope, true);
    assert.equal(snap.status, "needs_attention");
    assert.equal(snap.checks.find((c) => c.key === "email")?.ready, false);
    console.log(
      "PASS: scoped setup, widget reuse, stale edit protection, RLS, OAuth grant checks/replay/pause protection, encrypted shared credentials, new email → durable queue → shared CRM conversation → agent work, duplicate/history filtering, channel controls and read-only provider probes. No live provider or model calls.",
    );
  } finally {
    for (const table of [
      "agent_work_items",
      "action_jobs",
      "approval_items",
      "business_conversations",
      "business_agent_activation",
      "business_activation_oauth_attempts",
      "inbound_event_jobs",
      "integration_events",
    ]) {
      unwrap(
        await admin.from(table).delete().in("client_id", [clientId, otherId]),
      );
    }
    unwrap(
      await admin
        .from("client_businesses")
        .delete()
        .in("id", [clientId, otherId]),
    );
    unwrap(await admin.from("partners").delete().eq("id", partnerId));
    await owner.auth.signOut({ scope: "local" });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack : "Verification failed");
  process.exitCode = 1;
});
