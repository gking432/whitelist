import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { syncRunToCrm } from "@/lib/crm/sync-from-run";
import {
  templateHandlers,
  type HandlerResult,
} from "@/lib/workflows/handlers";

// Workflow run engine v1. Runs synchronously today, but is deliberately
// isolated from HTTP concerns: it takes a Supabase client plus a normalized
// trigger event, so the same entry point can move behind a queue worker
// without changes to callers' contracts.
//
// The engine is invoked with a service-role client from trusted server paths.
// It must always scope queries by the event's partner/client ids.

export type EngineTriggerEvent = {
  id: string;
  partnerId: string;
  clientId: string;
  connectionId: string | null;
  eventType: string;
  data: Record<string, unknown>;
};

export type EngineRunResult = {
  runId: string;
  templateKey: string;
  status: "succeeded" | "failed" | "paused_for_approval";
};

export type EngineResult = {
  matchedInstances: number;
  runs: EngineRunResult[];
};

type TemplateRecord = {
  id: string;
  template_key: string;
  name: string;
  risk_level: "low" | "medium" | "high";
  requires_approval_default: boolean;
};

type InstanceRecord = {
  id: string;
  partner_id: string;
  client_id: string;
  template_id: string;
  name: string;
  status: string;
  runtime_mode: string;
  settings: Record<string, unknown>;
  approval_policy: Record<string, unknown>;
};

function approvalRequired(
  instance: InstanceRecord,
  template: TemplateRecord,
): boolean {
  const policyValue = instance.approval_policy?.requires_approval;

  if (typeof policyValue === "boolean") {
    return policyValue;
  }

  return template.requires_approval_default;
}

async function emitUsageEvent(
  supabase: SupabaseClient,
  event: EngineTriggerEvent,
  templateKey: string,
  status: string,
) {
  await supabase.from("usage_events").insert({
    partner_id: event.partnerId,
    client_id: event.clientId,
    event_type: "workflow_run",
    quantity: 1,
    unit: "run",
    metadata: { template_key: templateKey, status },
  });
}

async function executeInstance(
  supabase: SupabaseClient,
  event: EngineTriggerEvent,
  instance: InstanceRecord,
  template: TemplateRecord,
  clientName: string,
): Promise<EngineRunResult | null> {
  const startedAt = new Date().toISOString();

  const { data: run, error: runInsertError } = await supabase
    .from("workflow_runs")
    .insert({
      partner_id: event.partnerId,
      client_id: event.clientId,
      workflow_instance_id: instance.id,
      template_id: template.id,
      trigger_event_id: event.id,
      status: "running",
      runtime_mode: instance.runtime_mode,
      started_at: startedAt,
      input_snapshot: {
        event_type: event.eventType,
        data: event.data,
      },
    })
    .select("id")
    .single();

  if (runInsertError || !run) {
    return null;
  }

  const runId: string = run.id;

  try {
    const handler = templateHandlers[template.template_key];

    if (!handler) {
      throw Object.assign(
        new Error(
          `No handler is registered for template "${template.template_key}".`,
        ),
        { code: "handler_missing" },
      );
    }

    const result: HandlerResult = await handler({
      eventType: event.eventType,
      data: event.data,
      settings: instance.settings ?? {},
      clientName,
    });

    const needsApproval = Boolean(result.approvalDraft) &&
      approvalRequired(instance, template);

    // Pilot loop: lead-bearing runs upsert the contact + AI Assistant note
    // in the client's connected CRM (additive-only; explicitly safe). Dry
    // run unless the CRM connection is live. Never fails the run.
    const crmSync = await syncRunToCrm(supabase, {
      partnerId: event.partnerId,
      clientId: event.clientId,
      runId,
      templateKey: template.template_key,
      clientName,
      eventType: event.eventType,
      eventData: event.data,
      runSummary: result.summary,
    });

    const steps = crmSync ? [...result.steps, crmSync.step] : result.steps;

    const outputSnapshot: Record<string, unknown> = {
      steps,
      output: result.output,
      ...(crmSync ? { crm: crmSync.crm } : {}),
      // How the output was produced (ai vs deterministic fallback) plus the
      // redacted context the handler worked from — run detail renders both.
      ai: result.ai ?? null,
      context_snapshot: {
        client_name: clientName,
        event_type: event.eventType,
        settings: redactAuditValue(instance.settings ?? {}),
      },
    };

    if (result.approvalDraft && !needsApproval) {
      outputSnapshot.note =
        "Draft prepared without approval requirement by policy. No delivery occurs in this release.";
    }

    if (needsApproval && result.approvalDraft) {
      const { error: approvalError } = await supabase
        .from("approval_items")
        .insert({
          partner_id: event.partnerId,
          client_id: event.clientId,
          workflow_run_id: runId,
          type: result.approvalDraft.type,
          status: "pending",
          title: result.approvalDraft.title,
          summary: result.approvalDraft.summary,
          risk_level: result.approvalDraft.riskLevel,
          proposed_payload: result.approvalDraft.proposedPayload,
          editable_content: result.approvalDraft.editableContent,
        });

      if (approvalError) {
        throw Object.assign(
          new Error("The approval item could not be created."),
          { code: "approval_create_failed" },
        );
      }

      await supabase
        .from("workflow_runs")
        .update({
          status: "paused_for_approval",
          requires_approval: true,
          summary: result.summary,
          output_snapshot: outputSnapshot,
        })
        .eq("id", runId);

      await supabase
        .from("client_workflow_instances")
        .update({ last_run_at: startedAt, health_status: "healthy" })
        .eq("id", instance.id);

      await emitUsageEvent(
        supabase,
        event,
        template.template_key,
        "paused_for_approval",
      );

      return {
        runId,
        templateKey: template.template_key,
        status: "paused_for_approval",
      };
    }

    await supabase
      .from("workflow_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        summary: result.summary,
        output_snapshot: outputSnapshot,
      })
      .eq("id", runId);

    await supabase
      .from("client_workflow_instances")
      .update({ last_run_at: startedAt, health_status: "healthy" })
      .eq("id", instance.id);

    await emitUsageEvent(supabase, event, template.template_key, "succeeded");

    return { runId, templateKey: template.template_key, status: "succeeded" };
  } catch (error) {
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code: unknown }).code)
        : "run_failed";
    const errorMessage =
      error instanceof Error ? error.message : "Workflow run failed.";

    await supabase
      .from("workflow_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        summary: `Run failed: ${errorMessage}`,
        error_code: errorCode,
        error_message: errorMessage,
      })
      .eq("id", runId);

    await supabase
      .from("client_workflow_instances")
      .update({ last_run_at: startedAt, health_status: "attention" })
      .eq("id", instance.id);

    await emitUsageEvent(supabase, event, template.template_key, "failed");

    return { runId, templateKey: template.template_key, status: "failed" };
  }
}

export async function runWorkflowsForEvent(
  supabase: SupabaseClient,
  event: EngineTriggerEvent,
): Promise<EngineResult> {
  const { data: templates, error: templatesError } = await supabase
    .from("workflow_templates")
    .select("id, template_key, name, risk_level, requires_approval_default")
    .contains("trigger_events", [event.eventType])
    .eq("is_active", true);

  if (templatesError) {
    throw new Error(`Template lookup failed: ${templatesError.message}`);
  }

  if (!templates || templates.length === 0) {
    return { matchedInstances: 0, runs: [] };
  }

  const templateById = new Map(
    (templates as TemplateRecord[]).map((template) => [template.id, template]),
  );

  const { data: instances, error: instancesError } = await supabase
    .from("client_workflow_instances")
    .select(
      "id, partner_id, client_id, template_id, name, status, runtime_mode, settings, approval_policy",
    )
    .eq("client_id", event.clientId)
    .eq("partner_id", event.partnerId)
    .eq("status", "active")
    .in("template_id", [...templateById.keys()]);

  if (instancesError) {
    throw new Error(`Instance lookup failed: ${instancesError.message}`);
  }

  const { data: client } = await supabase
    .from("client_businesses")
    .select("name")
    .eq("id", event.clientId)
    .maybeSingle();

  const clientName: string = client?.name ?? "the business";
  const runs: EngineRunResult[] = [];
  let matched = 0;

  for (const instance of (instances ?? []) as InstanceRecord[]) {
    const template = templateById.get(instance.template_id);

    if (!template) {
      continue;
    }

    matched += 1;

    // Paused/disabled workflows never run; the paused runtime mode also
    // suppresses execution while keeping the instance visible.
    if (instance.runtime_mode === "paused") {
      continue;
    }

    const result = await executeInstance(
      supabase,
      event,
      instance,
      template,
      clientName,
    );

    if (result) {
      runs.push(result);
    }
  }

  return { matchedInstances: matched, runs };
}
