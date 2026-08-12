import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { access } from "node:fs/promises";

import { createChunks, stringToBase64URL } from "@supabase/ssr";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { generateWidgetKey } from "../lib/chat/widget.ts";
import { encryptProviderCredentials } from "../lib/integrations/credentials.ts";
import { computeTwilioSignature } from "../lib/integrations/twilio-signature.ts";
import { deployPackageToClient } from "../lib/packages/deployment.ts";
import { buildAccessContext } from "../lib/permissions/roles.ts";
import { triageAndPersistSupportTicket } from "../lib/support/service.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
let appUrl = process.env.RELEASE_JOURNEY_APP_URL?.replace(/\/$/, "") ?? "";

if (!url || !anonKey || !serviceKey) {
  throw new Error("Local Supabase configuration is required.");
}

// Keep the release gate deterministic. Real model/provider behavior is proven
// separately by the audited production pilot.
process.env.ANTHROPIC_API_KEY = "";
process.env.OPENAI_API_KEY = "";

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const runKey = randomUUID().slice(0, 8);
const password = `Release-${randomUUID()}!`;
const ids = {
  partner: randomUUID(),
  client: randomUUID(),
  package: randomUUID(),
  platformUser: "",
  partnerUser: "",
  clientUser: "",
};

type CreatedIdentity = {
  id: string;
  email: string;
  client: SupabaseClient;
  cookie: string;
};

function sessionCookie(session: Session) {
  const projectRef = new URL(url!).hostname.split(".")[0];
  const name = `sb-${projectRef}-auth-token`;
  const encoded = `base64-${stringToBase64URL(JSON.stringify(session))}`;

  return createChunks(name, encoded)
    .map((chunk) => `${chunk.name}=${encodeURIComponent(chunk.value)}`)
    .join("; ");
}

async function createIdentity(label: string): Promise<CreatedIdentity> {
  const email = `release-${runKey}-${label}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: `Release ${label}` },
  });
  assert.ifError(error);
  assert.ok(data.user);

  const client = createClient(url!, anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await client.auth.signInWithPassword({ email, password });
  assert.ifError(signedIn.error);
  assert.ok(signedIn.data.session);
  return {
    id: data.user.id,
    email,
    client,
    cookie: sessionCookie(signedIn.data.session),
  };
}

async function insertOrThrow(
  table: string,
  values: Record<string, unknown> | Record<string, unknown>[],
) {
  const { error } = await admin.from(table).insert(values);
  assert.ifError(error);
}

async function fixtureCount(table: string, column: string, value: string) {
  const { count, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  assert.ifError(error);
  return count ?? 0;
}

async function providerId(providerKey: string) {
  const { data, error } = await admin
    .from("integration_providers")
    .select("id")
    .eq("provider_key", providerKey)
    .single();
  assert.ifError(error);
  assert.ok(data);
  return data.id;
}

async function postBridgeEvent(input: {
  connectionId: string;
  token: string;
  eventType: string;
  idempotencyKey: string;
  data: Record<string, unknown>;
}) {
  const response = await fetch(
    `${appUrl}/api/integrations/inbound/${input.connectionId}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-token": input.token,
      },
      body: JSON.stringify({
        event_type: input.eventType,
        idempotency_key: input.idempotencyKey,
        source: "release_journey",
        data: input.data,
      }),
    },
  );
  const raw = await response.text();
  assert.equal(response.status, 202, raw);
  return JSON.parse(raw) as {
    runs_started: number;
    runs: { run_id: string; template_key: string; status: string }[];
  };
}

async function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function startReleaseServer() {
  const serverPath = ".next/standalone/server.js";
  try {
    await access(serverPath);
  } catch {
    throw new Error(
      "The production application is not built. Run `npm run build` before the release journey.",
    );
  }

  const port = await availablePort();
  appUrl = `http://127.0.0.1:${port}`;
  const output: string[] = [];
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      APP_URL: appUrl,
      ANTHROPIC_API_KEY: "",
      HOSTNAME: "127.0.0.1",
      OPENAI_API_KEY: "",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on("data", (chunk) => {
      output.push(String(chunk));
      if (output.length > 40) output.shift();
    });
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(
        `Release server exited before becoming healthy.\n${output.join("")}`,
      );
    }
    try {
      const health = await fetch(`${appUrl}/api/health`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (health.ok) {
        const body = (await health.json()) as {
          checks?: { database_schema?: string };
        };
        if (body.checks?.database_schema === "ready") return child;
      }
    } catch {
      // Production startup can take a moment on a cold build.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  child.kill("SIGTERM");
  throw new Error(
    `Release server did not become healthy at ${appUrl}.\n${output.join("")}`,
  );
}

async function stopReleaseServer(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
        resolve();
      }, 5_000),
    ),
  ]);
}

async function main() {
  let platform: CreatedIdentity | null = null;
  let partner: CreatedIdentity | null = null;
  let client: CreatedIdentity | null = null;

  try {
    [platform, partner, client] = await Promise.all([
      createIdentity("platform-owner"),
      createIdentity("partner-owner"),
      createIdentity("client-owner"),
    ]);
    ids.platformUser = platform.id;
    ids.partnerUser = partner.id;
    ids.clientUser = client.id;

    await insertOrThrow("partners", {
      id: ids.partner,
      name: `Release Partner ${runKey}`,
      slug: `release-partner-${runKey}`,
      status: "active",
      plan_key: "partner_v1",
      is_test_account: true,
    });
    await insertOrThrow("partner_branding", {
      partner_id: ids.partner,
      product_name: `Release CRM ${runKey}`,
      primary_color: "#123B2A",
      accent_color: "#C79A3B",
      support_label: "Agency Support",
    });
    await insertOrThrow("partner_onboarding", {
      partner_id: ids.partner,
      status: "completed",
      current_step: "plan",
      integrations_reviewed_at: new Date().toISOString(),
      plan_key: "partner_v1",
      setup_fee_cents: 100_000,
      monthly_fee_cents: 50_000,
      included_active_clients: 10,
      billing_status: "not_configured",
      plan_confirmed_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });
    await insertOrThrow("client_businesses", {
      id: ids.client,
      partner_id: ids.partner,
      name: `Release Client ${runKey}`,
      slug: `release-client-${runKey}`,
      status: "active",
      crm_operating_mode: "primary_crm",
      client_experience_mode: "northstar_crm",
      default_runtime_mode: "sandbox",
      timezone: "America/Chicago",
      client_portal_enabled: true,
      partner_can_edit_client_data: false,
      account_kind: "managed_client",
      is_test_account: true,
    });
    await insertOrThrow("memberships", [
      {
        user_id: platform.id,
        partner_id: null,
        client_id: null,
        role: "platform_owner",
        status: "active",
      },
      {
        user_id: partner.id,
        partner_id: ids.partner,
        client_id: null,
        role: "partner_owner",
        status: "active",
      },
      {
        user_id: client.id,
        partner_id: ids.partner,
        client_id: ids.client,
        role: "client_owner",
        status: "active",
      },
    ]);

    const capabilities = {
      northstar_crm: true,
      lead_intake: true,
      message_drafting: true,
      approval_gated_sending: true,
      ai_intake_routing: true,
      website_ai_chat: true,
      live_call_assistant: true,
      live_scheduling_assistant: true,
      ai_phone_answering: true,
      appointment_booking: true,
      reports_portal: true,
    };
    await insertOrThrow("partner_packages", {
      id: ids.package,
      partner_id: ids.partner,
      name: `Release Operations ${runKey}`,
      description: "Isolated end-to-end release verification package.",
      capabilities,
      created_by: partner.id,
    });

    const deployment = await deployPackageToClient(admin, {
      partnerId: ids.partner,
      clientId: ids.client,
      packageId: ids.package,
      userId: partner.id,
    });
    assert.ok(deployment.bridge?.oneTimeToken);
    assert.ok(deployment.provisionedWorkflowKeys.includes("new_lead_intake"));
    assert.ok(
      deployment.provisionedWorkflowKeys.includes("missed_call_rescue"),
    );
    assert.ok(deployment.provisionedWorkflowKeys.includes("ai_intake_router"));
    assert.ok(deployment.automationPackKeys.includes("universal-lead-capture"));
    assert.ok(deployment.automationPackKeys.includes("live-call-assistant"));

    const workizProviderId = await providerId("workiz");
    const { data: fieldService, error: fieldServiceError } = await admin
      .from("integration_connections")
      .insert({
        partner_id: ids.partner,
        client_id: ids.client,
        provider_id: workizProviderId,
        display_name: "Release Workiz preview",
        status: "connected",
        runtime_mode: "sandbox",
        credential_status: "configured",
        config: { verification_fixture: runKey },
      })
      .select("id")
      .single();
    assert.ifError(fieldServiceError);
    assert.ok(fieldService);

    const widgetKey = generateWidgetKey();
    const { data: chatConnection, error: chatConnectionError } = await admin
      .from("integration_connections")
      .insert({
        partner_id: ids.partner,
        client_id: ids.client,
        provider_id: await providerId("northstar_web_chat"),
        display_name: "Release website chat",
        status: "connected",
        runtime_mode: "sandbox",
        credential_status: "configured",
        config: { widget_public_key: widgetKey },
        health_summary: "Release journey managed chat.",
        created_by: partner.id,
      })
      .select("id")
      .single();
    assert.ifError(chatConnectionError);
    assert.ok(chatConnection);

    const twilioAuthToken = `release-${randomUUID()}`;
    const { data: twilioConnection, error: twilioConnectionError } = await admin
      .from("integration_connections")
      .insert({
        partner_id: ids.partner,
        client_id: ids.client,
        provider_id: await providerId("twilio"),
        display_name: "Release Twilio contract",
        status: "connected",
        runtime_mode: "sandbox",
        credential_status: "configured",
        config: { release_fixture: runKey },
        health_summary: "Release journey signed webhook contract.",
        created_by: partner.id,
      })
      .select("id")
      .single();
    assert.ifError(twilioConnectionError);
    assert.ok(twilioConnection);
    const encryptedTwilio = encryptProviderCredentials({
      accountSid: `AC${"1".repeat(32)}`,
      authToken: twilioAuthToken,
      fromNumber: "+13125550100",
    });
    await insertOrThrow("integration_secrets", {
      partner_id: ids.partner,
      client_id: ids.client,
      connection_id: twilioConnection.id,
      secret_kind: "provider_credentials",
      ...encryptedTwilio,
    });

    await insertOrThrow(
      "crm_availability_windows",
      Array.from({ length: 7 }, (_, weekday) => ({
        partner_id: ids.partner,
        client_id: ids.client,
        weekday,
        start_time: "08:00",
        end_time: "18:00",
        appointment_minutes: 60,
        label: "Release availability",
      })),
    );

    const customerEmail = `customer-${runKey}@example.test`;
    const eventKey = `release-customer-${runKey}`;
    const intakeResult = await postBridgeEvent({
      connectionId: deployment.bridge.connectionId,
      token: deployment.bridge.oneTimeToken,
      eventType: "missed_call.created",
      idempotencyKey: eventKey,
      data: {
        name: "Jordan Release",
        email: customerEmail,
        phone: "+13125550199",
        address: "100 Release Way",
        message:
          "The water heater is leaking. Please call me as soon as possible.",
      },
    });
    assert.ok(intakeResult.runs_started >= 3);
    const runKeys = new Set(intakeResult.runs.map((run) => run.template_key));
    for (const key of [
      "new_lead_intake",
      "missed_call_rescue",
      "ai_intake_router",
    ]) {
      assert.ok(runKeys.has(key), `Expected ${key} to run.`);
    }
    assert.ok(
      intakeResult.runs.some((run) => run.status === "paused_for_approval"),
    );

    const duplicate = await fetch(
      `${appUrl}/api/integrations/inbound/${deployment.bridge.connectionId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webhook-token": deployment.bridge.oneTimeToken,
        },
        body: JSON.stringify({
          event_type: "missed_call.created",
          idempotency_key: eventKey,
          data: { email: customerEmail },
        }),
      },
    );
    assert.equal(duplicate.status, 200);
    assert.equal(
      ((await duplicate.json()) as { duplicate?: boolean }).duplicate,
      true,
    );

    const formEmail = `form-${runKey}@example.test`;
    const formResult = await postBridgeEvent({
      connectionId: deployment.bridge.connectionId,
      token: deployment.bridge.oneTimeToken,
      eventType: "form.submitted",
      idempotencyKey: `release-form-${runKey}`,
      data: {
        name: "Fran Form",
        email: formEmail,
        phone: "+13125550201",
        message: "Requesting a drain cleaning estimate.",
        channel: "website_form",
      },
    });
    assert.ok(formResult.runs_started >= 2);

    const emailLeadAddress = `forwarded-${runKey}@example.test`;
    const emailResult = await postBridgeEvent({
      connectionId: deployment.bridge.connectionId,
      token: deployment.bridge.oneTimeToken,
      eventType: "email.lead_received",
      idempotencyKey: `release-email-${runKey}`,
      data: {
        name: "Emery Email",
        email: emailLeadAddress,
        phone: "+13125550202",
        message: "Forwarded marketplace lead requesting HVAC repair.",
        channel: "email",
      },
    });
    assert.ok(emailResult.runs_started >= 2);

    const smsParams = {
      MessageSid: `SM${runKey.padEnd(32, "0")}`,
      From: "+13125550203",
      To: "+13125550100",
      Body: "I need an estimate for electrical panel service.",
    };
    const twilioWebhookUrl = `${appUrl}/api/integrations/inbound/twilio/${twilioConnection.id}`;
    const smsResponse = await fetch(twilioWebhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "x-twilio-signature": computeTwilioSignature(
          twilioAuthToken,
          twilioWebhookUrl,
          smsParams,
        ),
      },
      body: new URLSearchParams(smsParams),
    });
    assert.equal(smsResponse.status, 200, await smsResponse.text());

    const chatStart = await fetch(`${appUrl}/api/widget/${widgetKey}/session`, {
      method: "POST",
    });
    const chatStartBody = (await chatStart.json()) as {
      session_id?: string;
      greeting?: string;
    };
    assert.equal(chatStart.status, 200, JSON.stringify(chatStartBody));
    assert.ok(chatStartBody.session_id);
    assert.ok(chatStartBody.greeting?.includes("AI assistant"));
    const chatEmail = `chat-${runKey}@example.test`;
    const chatMessages = [
      "My kitchen sink is leaking.",
      "I am Casey Chat.",
      `Email me at ${chatEmail}.`,
      "Tomorrow morning works best.",
    ];
    let chatComplete = false;
    for (const message of chatMessages) {
      const replyResponse: Response = await fetch(
        `${appUrl}/api/widget/${widgetKey}/message`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            session_id: chatStartBody.session_id,
            message,
          }),
        },
      );
      const replyBody = (await replyResponse.json()) as {
        complete?: boolean;
        error?: string;
      };
      assert.equal(replyResponse.status, 200, JSON.stringify(replyBody));
      chatComplete = Boolean(replyBody.complete);
      if (chatComplete) break;
    }
    assert.equal(chatComplete, true, "Website chat did not complete intake.");

    const voiceStartResponse = await fetch(`${appUrl}/api/voice/simulate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: client.cookie,
      },
      body: JSON.stringify({
        action: "start",
        client_id: ids.client,
        from_number: "+13125550204",
      }),
    });
    const voiceStart = (await voiceStartResponse.json()) as {
      call_session_id?: string;
      greeting?: string;
      error?: string;
    };
    assert.equal(voiceStartResponse.status, 200, JSON.stringify(voiceStart));
    assert.ok(voiceStart.call_session_id);
    assert.ok(voiceStart.greeting);

    const voiceTurnResponse = await fetch(`${appUrl}/api/voice/simulate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: client.cookie,
      },
      body: JSON.stringify({
        action: "caller_turn",
        call_session_id: voiceStart.call_session_id,
        text: "I am Taylor Voice at 204 Release Road. My phone is 312-555-0204 and I need a furnace repair appointment tomorrow morning.",
      }),
    });
    const voiceTurn = (await voiceTurnResponse.json()) as {
      tools_used?: { name: string; result: Record<string, unknown> }[];
      error?: string;
    };
    assert.equal(voiceTurnResponse.status, 200, JSON.stringify(voiceTurn));
    const voiceTools = new Set(
      (voiceTurn.tools_used ?? []).map((tool) => tool.name),
    );
    assert.ok(voiceTools.has("save_contact_details"));
    assert.ok(voiceTools.has("propose_slots"));

    const assistantContextResponse = await fetch(
      `${appUrl}/api/assistant/context`,
      { headers: { cookie: client.cookie } },
    );
    const assistantContextBody = (await assistantContextResponse.json()) as {
      context?: {
        call?: { id?: string } | null;
        slots?: { label?: string; startIso?: string }[];
        transcript?: unknown[];
      };
      error?: string;
    };
    assert.equal(
      assistantContextResponse.status,
      200,
      JSON.stringify(assistantContextBody),
    );
    assert.equal(
      assistantContextBody.context?.call?.id,
      voiceStart.call_session_id,
    );
    assert.ok((assistantContextBody.context?.slots?.length ?? 0) >= 1);
    assert.ok((assistantContextBody.context?.transcript?.length ?? 0) >= 3);

    const assistantEventsResponse = await fetch(
      `${appUrl}/api/assistant/events`,
      { headers: { cookie: client.cookie } },
    );
    const assistantEventsBody = (await assistantEventsResponse.json()) as {
      events?: { event_type?: string; call_session_id?: string }[];
    };
    assert.equal(assistantEventsResponse.status, 200);
    assert.ok(
      assistantEventsBody.events?.some(
        (event) =>
          event.call_session_id === voiceStart.call_session_id &&
          event.event_type === "active_call_started",
      ),
    );

    const desktopResponse = await fetch(`${appUrl}/desktop/assistant`, {
      headers: { cookie: client.cookie },
    });
    const desktopHtml = await desktopResponse.text();
    assert.equal(desktopResponse.status, 200);
    assert.ok(!desktopHtml.includes("Sign in required"));

    const bookingTurnResponse = await fetch(`${appUrl}/api/voice/simulate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: client.cookie,
      },
      body: JSON.stringify({
        action: "caller_turn",
        call_session_id: voiceStart.call_session_id,
        text: "The first one works. Book it.",
      }),
    });
    const bookingTurn = (await bookingTurnResponse.json()) as {
      tools_used?: { name: string; result: Record<string, unknown> }[];
      error?: string;
    };
    assert.equal(bookingTurnResponse.status, 200, JSON.stringify(bookingTurn));
    assert.ok(
      bookingTurn.tools_used?.some(
        (tool) =>
          tool.name === "request_booking" && tool.result.status === "requested",
      ),
      "The voice assistant did not create an approval-gated booking request.",
    );

    const voiceCompleteResponse = await fetch(`${appUrl}/api/voice/simulate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: client.cookie,
      },
      body: JSON.stringify({
        action: "complete",
        call_session_id: voiceStart.call_session_id,
      }),
    });
    const voiceComplete = (await voiceCompleteResponse.json()) as {
      report?: {
        status?: string;
        transcript_turns?: number;
        intake_event?: { status?: string } | null;
        approvals_from_call?: { type?: string; status?: string }[];
      };
      error?: string;
    };
    assert.equal(
      voiceCompleteResponse.status,
      200,
      JSON.stringify(voiceComplete),
    );
    assert.equal(voiceComplete.report?.status, "completed");
    assert.ok((voiceComplete.report?.transcript_turns ?? 0) >= 5);
    assert.equal(voiceComplete.report?.intake_event?.status, "processed");
    assert.ok(
      voiceComplete.report?.approvals_from_call?.some(
        (approval) =>
          approval.type === "appointment_booking" &&
          approval.status === "pending",
      ),
    );

    assert.equal(await fixtureCount("crm_contacts", "email", customerEmail), 1);
    for (const channelEmail of [formEmail, emailLeadAddress, chatEmail]) {
      assert.equal(
        await fixtureCount("crm_contacts", "email", channelEmail),
        1,
      );
    }
    assert.ok((await fixtureCount("crm_leads", "client_id", ids.client)) >= 5);
    assert.ok((await fixtureCount("crm_tasks", "client_id", ids.client)) >= 1);
    assert.ok(
      (await fixtureCount("crm_timeline_entries", "client_id", ids.client)) >=
        1,
    );
    const { data: approvals } = await admin
      .from("approval_items")
      .select("id, status, title")
      .eq("client_id", ids.client)
      .eq("status", "pending");
    assert.ok((approvals?.length ?? 0) >= 1);
    const approvalId = approvals![0].id;

    const { data: previewEvents } = await admin
      .from("integration_events")
      .select("event_type, status, request_payload")
      .eq("connection_id", fieldService.id)
      .eq("status", "dry_run");
    assert.ok((previewEvents?.length ?? 0) >= 1);
    assert.ok(
      previewEvents?.some((event) =>
        event.event_type.includes("writeback_preview"),
      ),
    );
    assert.equal(
      await fixtureCount(
        "integration_sync_jobs",
        "connection_id",
        fieldService.id,
      ),
      0,
    );

    const { data: assistantEvents } = await admin
      .from("assistant_events")
      .select("event_type")
      .eq("client_id", ids.client);
    const assistantEventTypes = new Set(
      (assistantEvents ?? []).map((event) => event.event_type),
    );
    assert.ok(assistantEventTypes.has("lead_detected"));
    assert.ok(assistantEventTypes.has("approval_needed"));

    const { data: partnerApprovalRows } = await partner.client
      .from("approval_items")
      .select("id")
      .eq("client_id", ids.client);
    assert.ok((partnerApprovalRows?.length ?? 0) >= 1);
    const partnerAttempt = await partner.client
      .from("approval_items")
      .update({ status: "approved", resolved_by: partner.id })
      .eq("id", approvalId)
      .select("id");
    assert.ok(partnerAttempt.error || partnerAttempt.data.length === 0);

    const clientAttempt = await client.client
      .from("approval_items")
      .update({
        status: "rejected",
        resolved_by: client.id,
        resolved_at: new Date().toISOString(),
        resolution_note: "Release verification; no customer message sent.",
      })
      .eq("id", approvalId)
      .select("id, status")
      .single();
    assert.ifError(clientAttempt.error);
    assert.equal(clientAttempt.data.status, "rejected");

    const partnerAccess = buildAccessContext({
      userId: partner.id,
      role: "partner_owner",
      partnerId: ids.partner,
      clientId: ids.client,
      accountKind: "managed_client",
      partnerCanEditClientData: false,
    });
    assert.equal(partnerAccess.canResolveApprovals, false);
    assert.equal(partnerAccess.canOperateCustomerActions, false);
    const clientAccess = buildAccessContext({
      userId: client.id,
      role: "client_owner",
      partnerId: ids.partner,
      clientId: ids.client,
      accountKind: "managed_client",
    });
    assert.equal(clientAccess.canResolveApprovals, true);

    const { data: clientTicket, error: clientTicketError } = await client.client
      .from("support_tickets")
      .insert({
        partner_id: ids.partner,
        client_id: ids.client,
        requested_by: client.id,
        origin: "client",
        title: "Release support routing check",
        description: "Please check why a recent lead needs attention.",
        current_route: "partner",
      })
      .select("id")
      .single();
    assert.ifError(clientTicketError);
    assert.ok(clientTicket);
    await triageAndPersistSupportTicket({
      supabase: admin,
      ticketId: clientTicket.id,
      partnerId: ids.partner,
      clientId: ids.client,
      origin: "client",
      title: "Release support routing check",
      description: "Please check why a recent lead needs attention.",
    });
    const { data: routedClientTicket } = await admin
      .from("support_tickets")
      .select("status, current_route, ai_recommended_route")
      .eq("id", clientTicket.id)
      .single();
    assert.ok(routedClientTicket);
    assert.equal(routedClientTicket.current_route, "partner");
    assert.equal(routedClientTicket.status, "triaged");

    const { data: partnerTicket, error: partnerTicketError } =
      await partner.client
        .from("support_tickets")
        .insert({
          partner_id: ids.partner,
          client_id: ids.client,
          requested_by: partner.id,
          origin: "partner",
          title: "Connect ReleaseField CRM",
          description:
            "Build a new connector for the client API so leads can be synchronized.",
          current_route: "support_ai",
        })
        .select("id")
        .single();
    assert.ifError(partnerTicketError);
    assert.ok(partnerTicket);
    const integrationTriage = await triageAndPersistSupportTicket({
      supabase: admin,
      ticketId: partnerTicket.id,
      partnerId: ids.partner,
      clientId: ids.client,
      origin: "partner",
      title: "Connect ReleaseField CRM",
      description:
        "Build a new connector for the client API so leads can be synchronized.",
    });
    assert.equal(integrationTriage.triage.recommendedRoute, "codex");
    const { data: routedPartnerTicket } = await admin
      .from("support_tickets")
      .select("category, current_route, ai_recommended_route")
      .eq("id", partnerTicket.id)
      .single();
    assert.ok(routedPartnerTicket);
    assert.equal(routedPartnerTicket.category, "integration_request");
    assert.equal(routedPartnerTicket.ai_recommended_route, "codex");
    assert.equal(routedPartnerTicket.current_route, "platform");

    const { data: impersonation, error: impersonationError } = await admin
      .from("support_impersonation_sessions")
      .insert({
        actor_user_id: platform.id,
        actor_role: "platform_owner",
        target_kind: "partner",
        target_partner_id: ids.partner,
        mode: "read_only",
        reason: "Release journey support verification",
        return_path: "/control",
      })
      .select("id, mode, target_partner_id")
      .single();
    assert.ifError(impersonationError);
    assert.equal(impersonation.mode, "read_only");
    assert.equal(impersonation.target_partner_id, ids.partner);
    const ownerSupportAccess = buildAccessContext({
      userId: platform.id,
      role: "platform_owner",
      partnerId: ids.partner,
      impersonation: { id: impersonation.id, mode: "read_only" },
    });
    assert.equal(ownerSupportAccess.isImpersonating, true);
    assert.equal(ownerSupportAccess.canOperateCustomerActions, false);

    const { data: partnerVisibleTicket } = await partner.client
      .from("support_tickets")
      .select("id")
      .eq("id", clientTicket.id)
      .maybeSingle();
    assert.ok(partnerVisibleTicket);
    const { data: clientHiddenPartnerTicket } = await client.client
      .from("support_tickets")
      .select("id")
      .eq("id", partnerTicket.id)
      .maybeSingle();
    assert.equal(clientHiddenPartnerTicket, null);

    console.log(
      JSON.stringify(
        {
          verified: true,
          roles: [
            "platform_owner",
            "partner_owner",
            "client_owner",
            "customer",
          ],
          package: {
            workflows: [...runKeys].sort(),
            automation_packs: deployment.automationPackKeys,
          },
          customer_channels: {
            form: "processed",
            forwarded_email_envelope: "processed",
            signed_twilio_sms: "processed",
            website_chat: "processed",
            ai_phone: "processed",
            appointment_request: "pending_client_approval",
            desktop_assistant: "authenticated_live_context",
          },
          customer_records: {
            duplicate_protected: true,
            crm_contact_count: await fixtureCount(
              "crm_contacts",
              "client_id",
              ids.client,
            ),
            crm_lead_count: await fixtureCount(
              "crm_leads",
              "client_id",
              ids.client,
            ),
            approval_count: approvals?.length ?? 0,
            external_write: "dry_run_preview",
            assistant_events: [...assistantEventTypes].sort(),
          },
          permissions: {
            partner_can_observe_approval: true,
            partner_can_resolve_approval: false,
            client_can_resolve_approval: true,
          },
          support: {
            client_route: routedClientTicket.current_route,
            integration_recommendation:
              routedPartnerTicket.ai_recommended_route,
            integration_control_route: routedPartnerTicket.current_route,
          },
          owner_support_context: impersonation.mode,
        },
        null,
        2,
      ),
    );
  } finally {
    if (ids.partner) {
      const { error } = await admin
        .from("partners")
        .delete()
        .eq("id", ids.partner);
      assert.ifError(error);
      assert.equal(
        await fixtureCount("client_businesses", "id", ids.client),
        0,
        "Release client fixtures were not removed.",
      );
    }
    for (const userId of [ids.platformUser, ids.partnerUser, ids.clientUser]) {
      if (userId) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        assert.ifError(error);
      }
    }
  }
}

async function run() {
  const releaseServer = appUrl ? null : await startReleaseServer();
  try {
    await main();
  } finally {
    await stopReleaseServer(releaseServer);
  }
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
