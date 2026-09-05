import { settleWorkflowApprovals } from "@/lib/approvals/workflow-status";
import { commitInboxLease, createApprovedExternalRun } from "./protocol.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAutomationPack } from "@/lib/automation-packs/catalog";
import { enqueueInboundEvent } from "@/lib/integrations/inbound/queue";
import type { DeliveryOutcome } from "@/lib/delivery/customer-message";
import type { ActionJobRecord } from "@/lib/jobs/record";
import { mapFields, type FieldMapping } from "./mapping.ts";
import { zapierConfiguration, zapierForIdentity } from "./zapier.ts";

export type EmbeddedConnection = {
  id: string;
  partner_id: string;
  client_id: string;
  authorizing_user_id: string;
  app_id: string;
  app_key: string;
  app_title: string;
  authentication_id: string;
};
export type EmbeddedBinding = {
  id: string;
  partner_id: string;
  client_id: string;
  connection_id: string;
  direction: "inbound" | "outbound";
  pack_key: string;
  event_type: string;
  template_key: string | null;
  action_key: string;
  action_title: string;
  inputs: Record<string, unknown>;
  field_mapping: FieldMapping;
  inbox_id: string | null;
  status: string;
  verified_at: string | null;
  updated_at: string;
};

export async function connectionClient(
  admin: SupabaseClient,
  connection: EmbeddedConnection,
) {
  // Zapier requires the same sub at connect and execution time. Revoking the
  // authorizer's membership stops use rather than silently changing identities.
  const { data } = await admin
    .from("memberships")
    .select("id,client_id,role")
    .eq("user_id", connection.authorizing_user_id)
    .eq("partner_id", connection.partner_id)
    .eq("status", "active")
    .throwOnError();
  if (
    !data?.some(
      (row) =>
        (row.client_id === connection.client_id &&
          ["client_owner", "client_manager"].includes(row.role)) ||
        (row.client_id === null &&
          ["partner_owner", "partner_admin", "partner_implementer"].includes(
            row.role,
          )),
    )
  )
    throw new Error(
      "The person who authorized this connection no longer has access. Connect the account again.",
    );
  return zapierForIdentity({
    partnerId: connection.partner_id,
    clientId: connection.client_id,
    userId: connection.authorizing_user_id,
  });
}

export async function loadEmbeddedConnection(
  admin: SupabaseClient,
  id: string,
  partnerId: string,
  clientId: string,
) {
  const { data } = await admin
    .from("embedded_app_connections")
    .select("*")
    .eq("id", id)
    .eq("partner_id", partnerId)
    .eq("client_id", clientId)
    .single()
    .throwOnError();
  return data as EmbeddedConnection;
}

export async function connectionIsLive(
  admin: SupabaseClient,
  connection: EmbeddedConnection,
) {
  const [{ data: source }, { data: client }] = await Promise.all([
    admin
      .from("integration_connections")
      .select("status,runtime_mode")
      .eq("id", connection.id)
      .eq("partner_id", connection.partner_id)
      .eq("client_id", connection.client_id)
      .single()
      .throwOnError(),
    admin
      .from("client_businesses")
      .select("status,default_runtime_mode")
      .eq("id", connection.client_id)
      .eq("partner_id", connection.partner_id)
      .single()
      .throwOnError(),
  ]);
  return (
    source.status === "connected" &&
    source.runtime_mode === "live" &&
    client.status === "active" &&
    client.default_runtime_mode === "live"
  );
}

export async function pollEmbeddedInboxes(admin: SupabaseClient, limit = 3) {
  if (!zapierConfiguration().configured)
    return { processed: 0, failed: 0, configured: false };
  const { data } = await admin
    .from("embedded_solution_bindings")
    .select("*")
    .eq("direction", "inbound")
    .eq("status", "enabled")
    .not("verified_at", "is", null)
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(limit)
    .throwOnError();
  let processed = 0,
    failed = 0;
  for (const binding of data as EmbeddedBinding[]) {
    await admin
      .from("embedded_solution_bindings")
      .update({ last_polled_at: new Date().toISOString() })
      .eq("id", binding.id)
      .throwOnError();
    try {
      const connection = await loadEmbeddedConnection(
        admin,
        binding.connection_id,
        binding.partner_id,
        binding.client_id,
      );
      if (!binding.inbox_id || !(await connectionIsLive(admin, connection)))
        continue;
      const api = await connectionClient(admin, connection);
      const pack = getAutomationPack(binding.pack_key);
      if (!pack) throw new Error("Solution no longer exists.");
      const lease = await api.lease(binding.inbox_id, 5);
      processed += await commitInboxLease({
        lease,
        binding,
        requiredFields: pack.requiredFields,
        commit: (id, values) =>
          enqueueInboundEvent(admin, {
            partnerId: binding.partner_id,
            clientId: binding.client_id,
            connectionId: binding.connection_id,
            eventType: binding.event_type,
            idempotencyKey: `zapier:${binding.inbox_id}:${id}`,
            data: values,
          }),
        acknowledge: (leaseId, ids) => api.ack(binding.inbox_id!, leaseId, ids),
      });
      await admin
        .from("embedded_solution_bindings")
        .update({ last_success_at: new Date().toISOString(), last_error: null })
        .eq("id", binding.id)
        .throwOnError();
    } catch {
      failed += 1;
      await admin
        .from("embedded_solution_bindings")
        .update({
          status: "needs_attention",
          last_error:
            "Event collection needs review. Check the app account and test the field mapping again. Unconfirmed events remain in the provider inbox.",
        })
        .eq("id", binding.id)
        .throwOnError();
    }
  }
  return { processed, failed };
}

export async function queueEmbeddedWorkflowActions(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    runId: string;
    templateKey: string;
    eventType: string;
    eventData: Record<string, unknown>;
    summary: string;
    output: Record<string, unknown>;
    simulation?: boolean;
  },
) {
  if (input.simulation) return 0;
  const { data } = await admin
    .from("embedded_solution_bindings")
    .select("*")
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("direction", "outbound")
    .eq("status", "enabled")
    .eq("template_key", input.templateKey)
    .eq("event_type", input.eventType)
    .not("verified_at", "is", null)
    .throwOnError();
  let queued = 0;
  for (const binding of data as EmbeddedBinding[]) {
    const connection = await loadEmbeddedConnection(
      admin,
      binding.connection_id,
      input.partnerId,
      input.clientId,
    );
    if (!(await connectionIsLive(admin, connection))) continue;
    const values = mapFields(
      { input: input.eventData, summary: input.summary, output: input.output },
      binding.field_mapping,
    );
    // The approval shows the exact target app, operation and concrete fields.
    // No model gets a token or permission to select a different operation.
    const { error } = await admin.from("approval_items").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      workflow_run_id: input.runId,
      embedded_binding_id: binding.id,
      type: "external_action",
      status: "pending",
      title: `${connection.app_title}: ${binding.action_title}`,
      summary:
        "Review these exact fields before they are submitted to the connected app.",
      risk_level: "high",
      editable_content: null,
      proposed_payload: {
        binding_id: binding.id,
        connection_id: connection.id,
        app_id: connection.app_id,
        authentication_id: connection.authentication_id,
        action_key: binding.action_key,
        input: values,
      },
    });
    if (!error) queued += 1;
    if (error && error.code !== "23505")
      throw new Error("External action approval could not be saved.");
  }
  return queued;
}

export async function executeEmbeddedAction(
  admin: SupabaseClient,
  job: ActionJobRecord,
): Promise<DeliveryOutcome> {
  const { data } = await admin
    .from("embedded_solution_bindings")
    .select("*")
    .eq("id", String(job.payload.binding_id))
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .single()
    .throwOnError();
  const binding = data as EmbeddedBinding;
  if (
    binding.status !== "enabled" ||
    !binding.verified_at ||
    binding.direction !== "outbound"
  )
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail: "This app action is paused or needs testing.",
    };
  const connection = await loadEmbeddedConnection(
    admin,
    binding.connection_id,
    job.partner_id,
    job.client_id,
  );
  if (
    job.payload.connection_id !== connection.id ||
    job.payload.app_id !== connection.app_id ||
    job.payload.authentication_id !== connection.authentication_id ||
    job.payload.action_key !== binding.action_key
  )
    throw new Error("Approved app target no longer matches the connection.");
  if (!(await connectionIsLive(admin, connection)))
    return {
      status: "dry_run",
      attempted: false,
      delivered: false,
      detail:
        "The client or app connection is in preview. The action was recorded without being submitted.",
    };
  if (!job.workflow_run_id)
    throw new Error("External action has no source workflow.");
  const { data: sourceRun } = await admin
    .from("workflow_runs")
    .select("status,instance:client_workflow_instances(status,runtime_mode)")
    .eq("id", job.workflow_run_id)
    .eq("partner_id", job.partner_id)
    .eq("client_id", job.client_id)
    .single()
    .throwOnError();
  const instance = sourceRun.instance as unknown as {
    status: string;
    runtime_mode: string;
  };
  if (
    ["failed", "cancelled"].includes(sourceRun.status) ||
    instance?.status !== "active" ||
    instance?.runtime_mode !== "live"
  )
    return {
      status: "skipped",
      attempted: false,
      delivered: false,
      detail:
        "The source workflow is no longer active and live. Review it before submitting this action.",
    };
  const api = await connectionClient(admin, connection);
  return createApprovedExternalRun(api, {
    appId: connection.app_id,
    authenticationId: connection.authentication_id,
    actionKey: binding.action_key,
    values: job.payload.input as Record<string, unknown>,
    onRunId: async (id) => {
      await admin
        .from("action_jobs")
        .update({ external_ref: id })
        .eq("id", job.id)
        .eq("status", "processing")
        .throwOnError();
    },
  });
}

export async function pollEmbeddedActionResults(
  admin: SupabaseClient,
  limit = 3,
) {
  if (!zapierConfiguration().configured) return { processed: 0, failed: 0 };
  const { data } = await admin
    .from("action_jobs")
    .select("*")
    .eq("kind", "external.action")
    .in("status", ["provider_pending", "uncertain"])
    .not("external_ref", "is", null)
    .order("last_attempt_at", { ascending: true })
    .limit(limit)
    .throwOnError();
  let processed = 0,
    failed = 0;
  for (const job of data as Array<ActionJobRecord & { external_ref: string }>) {
    try {
      const connection = await loadEmbeddedConnection(
        admin,
        String(job.payload.connection_id),
        job.partner_id,
        job.client_id,
      );
      const api = await connectionClient(admin, connection);
      // Read-only status reconciliation remains allowed when locally paused.
      const { data: run } = await api.run(job.external_ref);
      const status =
        run.status === "success"
          ? "succeeded"
          : run.status === "error"
            ? "uncertain"
            : "provider_pending";
      const detail =
        status === "succeeded"
          ? "The connected app confirmed this action completed."
          : status === "uncertain"
            ? "The connected app reported an error. Review it for partial changes before any new submission."
            : "Waiting for the connected app to finish.";
      await admin
        .from("action_jobs")
        .update({
          status,
          last_attempt_at: new Date().toISOString(),
          outcome_detail: detail,
          last_error: status === "uncertain" ? detail : null,
        })
        .eq("id", job.id)
        .eq("status", job.status)
        .throwOnError();
      if (job.workflow_run_id)
        await settleWorkflowApprovals(
          admin,
          job.partner_id,
          job.client_id,
          job.workflow_run_id,
        );
      processed += 1;
      if (status === "uncertain") failed += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed, failed };
}
