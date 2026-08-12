import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { deployPackageToClient } from "../lib/packages/deployment.ts";
import { buildAccessContext } from "../lib/permissions/roles.ts";
import { triageAndPersistSupportTicket } from "../lib/support/service.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const appUrl = (
  process.env.RELEASE_JOURNEY_APP_URL ?? "http://127.0.0.1:3010"
).replace(/\/$/, "");

if (!url || !anonKey || !serviceKey) {
  throw new Error("Local Supabase configuration is required.");
}

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
};

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
  return { id: data.user.id, email, client };
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
      ai_intake_routing: true,
      live_call_assistant: true,
      live_scheduling_assistant: true,
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

    const { data: workizProvider } = await admin
      .from("integration_providers")
      .select("id")
      .eq("provider_key", "workiz")
      .single();
    assert.ok(workizProvider);
    const { data: fieldService, error: fieldServiceError } = await admin
      .from("integration_connections")
      .insert({
        partner_id: ids.partner,
        client_id: ids.client,
        provider_id: workizProvider.id,
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

    const customerEmail = `customer-${runKey}@example.test`;
    const eventKey = `release-customer-${runKey}`;
    const intake = await fetch(
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
          source: "release_journey",
          data: {
            name: "Jordan Release",
            email: customerEmail,
            phone: "+13125550199",
            address: "100 Release Way",
            message:
              "The water heater is leaking. Please call me and schedule the earliest available appointment.",
          },
        }),
      },
    );
    const intakeBody = await intake.text();
    assert.equal(intake.status, 202, intakeBody);
    const intakeResult = JSON.parse(intakeBody) as {
      runs_started: number;
      runs: { run_id: string; template_key: string; status: string }[];
    };
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

    assert.equal(await fixtureCount("crm_contacts", "email", customerEmail), 1);
    assert.equal(await fixtureCount("crm_leads", "client_id", ids.client), 1);
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
          customer_event: {
            duplicate_protected: true,
            crm_contact_count: 1,
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
      await admin.from("partners").delete().eq("id", ids.partner);
    }
    for (const userId of [ids.platformUser, ids.partnerUser, ids.clientUser]) {
      if (userId) await admin.auth.admin.deleteUser(userId);
    }
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
