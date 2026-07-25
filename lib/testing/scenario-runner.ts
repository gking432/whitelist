import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import {
  addTranscriptTurn,
  completeCallSession,
  createCallSession,
} from "@/lib/voice/sessions";
import {
  runWorkflowsForEvent,
  type EngineRunResult,
} from "@/lib/workflows/engine";
import {
  getLabScenario,
  LAB_SCENARIOS,
  sanitizeLabValues,
  SCENARIO_LAB_CLIENT_SLUG,
  type LabScenarioDefinition,
  type LabScenarioKey,
  type LabScenarioValues,
} from "@/lib/testing/scenarios";

const LAB_CLIENT_NAME = "Northstar Scenario Lab";
const LAB_TEMPLATE_KEYS = [
  ...new Set(
    LAB_SCENARIOS.flatMap((scenario) => scenario.expectation.templates),
  ),
];

export type ScenarioLabClient = {
  id: string;
  name: string;
  slug: string;
};

export type ScenarioAssertion = {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
};

export type ScenarioLabRunResult = {
  status: "success" | "error";
  message: string;
  scenarioKey?: LabScenarioKey;
  scenarioTitle?: string;
  passed?: boolean;
  passedAssertions?: number;
  totalAssertions?: number;
  eventId?: string | null;
  callSessionId?: string | null;
  runIds?: string[];
  approvalIds?: string[];
  assertions?: ScenarioAssertion[];
  aiSources?: string[];
  links?: {
    runs: string;
    approvals: string;
    crm: string;
    assistant: string;
  };
};

type ScenarioRunInput = {
  partnerId: string;
  clientId: string;
  scenarioKey: string;
  values: LabScenarioValues;
  source?: "scenario_lab" | "launch_control";
  expectedTemplateKeys?: string[];
  minimumApprovals?: number;
  recordsContact?: boolean;
};

type RunRow = {
  id: string;
  status: string;
  template_id: string;
  output_snapshot: Record<string, unknown> | null;
};

type TemplateRow = {
  id: string;
  template_key: string;
};

export async function findScenarioLabClient(
  admin: SupabaseClient,
  partnerId: string,
): Promise<ScenarioLabClient | null> {
  const { data, error } = await admin
    .from("client_businesses")
    .select("id, name, slug")
    .eq("partner_id", partnerId)
    .eq("slug", SCENARIO_LAB_CLIENT_SLUG)
    .maybeSingle();

  if (error) {
    throw new Error(`The lab business lookup failed: ${error.message}`);
  }

  return (data as ScenarioLabClient | null) ?? null;
}

async function ensureLabWorkflows(
  admin: SupabaseClient,
  partnerId: string,
  clientId: string,
) {
  const { data: templates, error: templateError } = await admin
    .from("workflow_templates")
    .select(
      "id, template_key, name, default_runtime_mode, requires_approval_default",
    )
    .eq("is_active", true)
    .in("template_key", LAB_TEMPLATE_KEYS);

  if (templateError || !templates) {
    throw new Error("The workflow template catalog could not be loaded.");
  }

  const { data: existing } = await admin
    .from("client_workflow_instances")
    .select("id, template_id")
    .eq("partner_id", partnerId)
    .eq("client_id", clientId);

  const existingByTemplate = new Map(
    (existing ?? []).map((instance) => [instance.template_id, instance.id]),
  );

  const missing = templates.filter(
    (template) => !existingByTemplate.has(template.id),
  );

  if (missing.length > 0) {
    const { error } = await admin.from("client_workflow_instances").insert(
      missing.map((template) => ({
        partner_id: partnerId,
        client_id: clientId,
        template_id: template.id,
        name: template.name,
        status: "active",
        runtime_mode: "sandbox",
        settings: {},
        approval_policy: {
          requires_approval:
            template.requires_approval_default ||
            template.template_key === "new_lead_intake",
        },
      })),
    );

    if (error) {
      throw new Error("The lab workflows could not be enabled.");
    }
  }

  const instanceIds = [...existingByTemplate.values()];

  if (instanceIds.length > 0) {
    const { error: activationError } = await admin
      .from("client_workflow_instances")
      .update({ status: "active", runtime_mode: "sandbox" })
      .in("id", instanceIds);

    if (activationError) {
      throw new Error("The existing lab workflows could not be reactivated.");
    }
  }

  const leadTemplate = templates.find(
    (template) => template.template_key === "new_lead_intake",
  );

  if (leadTemplate) {
    const { error: approvalPolicyError } = await admin
      .from("client_workflow_instances")
      .update({ approval_policy: { requires_approval: true } })
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .eq("template_id", leadTemplate.id);

    if (approvalPolicyError) {
      throw new Error("The lab approval gate could not be enforced.");
    }
  }
}

export async function ensureScenarioLabClient(
  admin: SupabaseClient,
  input: { partnerId: string; userId: string },
): Promise<ScenarioLabClient> {
  let client = await findScenarioLabClient(admin, input.partnerId);

  if (!client) {
    const { data, error } = await admin
      .from("client_businesses")
      .insert({
        partner_id: input.partnerId,
        name: LAB_CLIENT_NAME,
        slug: SCENARIO_LAB_CLIENT_SLUG,
        status: "onboarding",
        industry: "Home services testing",
        crm_operating_mode: "primary_crm",
        default_runtime_mode: "sandbox",
        timezone: "America/Chicago",
        client_portal_enabled: false,
        partner_can_edit_client_data: true,
      })
      .select("id, name, slug")
      .single();

    if (error || !data) {
      throw new Error(
        `The isolated lab business could not be created${error?.message ? `: ${error.message}` : "."}`,
      );
    }

    client = data as ScenarioLabClient;
  }

  const { error: knowledgeError } = await admin
    .from("client_knowledge_profiles")
    .upsert(
    {
      partner_id: input.partnerId,
      client_id: client.id,
      business_description:
        "A fictional home-services company used only for Northstar scenario testing.",
      services_offered:
        "Plumbing, water heaters, HVAC maintenance, electrical troubleshooting, and roofing inspections.",
      service_areas: "Scenario City and nearby test neighborhoods.",
      business_hours: "Monday-Friday, 8:00 AM-6:00 PM.",
      booking_hours_start: 8,
      booking_hours_end: 18,
      appointment_duration_minutes: 60,
      emergency_rules:
        "Burst pipes, active flooding, no heat in dangerous weather, gas smells, and electrical hazards require immediate human escalation.",
      pricing_disclaimer:
        "Never quote a final price before an on-site assessment.",
      booking_rules:
        "Offer open weekday slots and require approval before creating an appointment.",
      escalation_rules:
        "Escalate emergencies, threats, payment disputes, and uncertain safety situations.",
      ai_disclosure:
        "Tell callers they are speaking with an AI assistant for the business.",
      voice_disclosure_mode: "explicit",
      updated_by: input.userId,
    },
      { onConflict: "client_id" },
    );

  if (knowledgeError) {
    throw new Error(
      `The lab knowledge profile could not be saved: ${knowledgeError.message}`,
    );
  }

  await ensureLabWorkflows(admin, input.partnerId, client.id);

  return client;
}

function scenarioData(
  scenario: LabScenarioDefinition,
  values: LabScenarioValues,
): Record<string, unknown> {
  const sanitized = sanitizeLabValues(scenario, values);

  return {
    ...scenario.staticData,
    ...sanitized,
    system: sanitized.provider,
    source_provider: sanitized.provider,
    is_test: true,
    scenario_lab: true,
    scenario_key: scenario.key,
  };
}

async function runEventScenario(
  admin: SupabaseClient,
  input: ScenarioRunInput,
  scenario: LabScenarioDefinition,
): Promise<{
  eventId: string;
  runResults: EngineRunResult[];
  callSessionId: null;
}> {
  const data = scenarioData(scenario, input.values);
  const source = input.source ?? "scenario_lab";
  const idempotencyKey = `${source}-${scenario.key}-${crypto.randomUUID()}`;

  const { data: insertedEvent, error } = await admin
    .from("integration_events")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: null,
      direction: "inbound",
      event_type: scenario.eventType,
      status: "received",
      idempotency_key: idempotencyKey,
      request_payload: redactAuditValue({
        source,
        scenario_key: scenario.key,
        event_type: scenario.eventType,
        data,
      }),
      redacted: true,
    })
    .select("id")
    .single();

  if (error || !insertedEvent) {
    throw new Error("The scenario event could not be created.");
  }

  try {
    const engineResult = await runWorkflowsForEvent(admin, {
      id: insertedEvent.id,
      partnerId: input.partnerId,
      clientId: input.clientId,
      connectionId: null,
      eventType: scenario.eventType,
      data,
      simulation: scenario.simulateCalendar
        ? { calendar: { outcome: "available" } }
        : undefined,
    });

    await admin
      .from("integration_events")
      .update({
        status: "processed",
        workflow_run_id: engineResult.runs[0]?.runId ?? null,
      })
      .eq("id", insertedEvent.id);

    return {
      eventId: insertedEvent.id,
      runResults: engineResult.runs,
      callSessionId: null,
    };
  } catch (engineError) {
    const message =
      engineError instanceof Error
        ? engineError.message
        : "The workflow engine failed.";

    await admin
      .from("integration_events")
      .update({
        status: "failed",
        error_code: "scenario_engine_failed",
        error_message: message,
      })
      .eq("id", insertedEvent.id);

    throw new Error(message);
  }
}

async function runPhoneTranscriptScenario(
  admin: SupabaseClient,
  input: ScenarioRunInput,
  scenario: LabScenarioDefinition,
): Promise<{
  eventId: string;
  runResults: EngineRunResult[];
  callSessionId: string;
}> {
  const values = sanitizeLabValues(scenario, input.values);
  const created = await createCallSession(admin, {
    partnerId: input.partnerId,
    clientId: input.clientId,
    provider: "scenario_lab",
    direction: "inbound",
    fromNumber: values.phone || null,
    externalRef: `scenario-lab-${crypto.randomUUID()}`,
  });

  if (!created) {
    throw new Error("The simulated call session could not be created.");
  }

  await addTranscriptTurn(admin, created.callSessionId, {
    role: "ai_assistant",
    content:
      "Thanks for calling. I am the AI assistant for the business. How can I help?",
  });
  await addTranscriptTurn(admin, created.callSessionId, {
    role: "caller",
    content: values.message || "The caller did not provide any details.",
  });
  await addTranscriptTurn(admin, created.callSessionId, {
    role: "ai_assistant",
    content:
      "Thank you. I recorded the request and the team will review the next action.",
  });

  const completed = await completeCallSession(admin, created.callSessionId);

  if (!completed) {
    throw new Error("The simulated call could not be completed.");
  }

  const { data: event } = await admin
    .from("integration_events")
    .select("id, request_payload")
    .eq("idempotency_key", `call-session-${created.callSessionId}`)
    .maybeSingle();

  if (!event) {
    throw new Error("The call completed, but its intake event was not created.");
  }

  const requestPayload =
    typeof event.request_payload === "object" && event.request_payload !== null
      ? (event.request_payload as Record<string, unknown>)
      : {};
  const requestData =
    typeof requestPayload.data === "object" && requestPayload.data !== null
      ? (requestPayload.data as Record<string, unknown>)
      : {};

  await admin
    .from("integration_events")
    .update({
      request_payload: redactAuditValue({
        ...requestPayload,
        source: "scenario_lab",
        scenario_key: scenario.key,
        data: {
          ...requestData,
          scenario_lab: true,
          scenario_key: scenario.key,
        },
      }),
    })
    .eq("id", event.id);

  const { data: runRows } = await admin
    .from("workflow_runs")
    .select("id, status, template_id")
    .eq("trigger_event_id", event.id);

  const templateIds = [
    ...new Set((runRows ?? []).map((run) => run.template_id)),
  ];
  const { data: templates } = templateIds.length
    ? await admin
        .from("workflow_templates")
        .select("id, template_key")
        .in("id", templateIds)
    : { data: [] as TemplateRow[] };
  const templateById = new Map(
    ((templates ?? []) as TemplateRow[]).map((template) => [
      template.id,
      template.template_key,
    ]),
  );

  return {
    eventId: event.id,
    callSessionId: created.callSessionId,
    runResults: (runRows ?? []).map((run) => ({
      runId: run.id,
      templateKey: templateById.get(run.template_id) ?? "unknown",
      status: run.status as EngineRunResult["status"],
    })),
  };
}

function readOutputSnapshots(rows: RunRow[]) {
  return rows.map((row) => {
    const snapshot = row.output_snapshot ?? {};
    const output =
      typeof snapshot.output === "object" && snapshot.output !== null
        ? (snapshot.output as Record<string, unknown>)
        : {};

    return { snapshot, output };
  });
}

function atLeastUrgency(actual: unknown, expected: string): boolean {
  const rank = new Map([
    ["low", 0],
    ["medium", 1],
    ["high", 2],
    ["emergency", 3],
  ]);

  return (
    typeof actual === "string" &&
    (rank.get(actual) ?? -1) >= (rank.get(expected) ?? Number.MAX_SAFE_INTEGER)
  );
}

async function buildAssertions(
  admin: SupabaseClient,
  input: ScenarioRunInput,
  scenario: LabScenarioDefinition,
  eventId: string,
  runResults: EngineRunResult[],
): Promise<{
  assertions: ScenarioAssertion[];
  approvalIds: string[];
  aiSources: string[];
}> {
  const runIds = runResults.map((run) => run.runId);
  const { data: event } = await admin
    .from("integration_events")
    .select("status")
    .eq("id", eventId)
    .maybeSingle();
  const { data: rowsData } = runIds.length
    ? await admin
        .from("workflow_runs")
        .select("id, status, template_id, output_snapshot")
        .in("id", runIds)
    : { data: [] as RunRow[] };
  const rows = (rowsData ?? []) as RunRow[];
  const outputs = readOutputSnapshots(rows);
  const { data: approvalsData } = runIds.length
    ? await admin
        .from("approval_items")
        .select("id, type, status")
        .in("workflow_run_id", runIds)
    : { data: [] as { id: string; type: string; status: string }[] };
  const approvals = approvalsData ?? [];
  const actualTemplates = new Set(runResults.map((run) => run.templateKey));
  const expectedTemplates =
    input.expectedTemplateKeys ?? scenario.expectation.templates;
  const missingTemplates = expectedTemplates.filter(
    (key) => !actualTemplates.has(key),
  );
  const assertions: ScenarioAssertion[] = [
    {
      key: "event_processed",
      label: "Intake event processed",
      passed: event?.status === "processed",
      detail: `Event status: ${event?.status ?? "missing"}.`,
    },
    {
      key: "expected_workflows",
      label: "Expected workflows ran",
      passed: missingTemplates.length === 0,
      detail:
        missingTemplates.length === 0
          ? expectedTemplates.join(", ") || "No package workflows required"
          : `Missing: ${missingTemplates.join(", ")}.`,
    },
    {
      key: "no_failed_runs",
      label: "No workflow run failed",
      passed:
        runResults.length > 0 &&
        runResults.every((run) => run.status !== "failed"),
      detail: runResults.length
        ? runResults
            .map((run) => `${run.templateKey}: ${run.status}`)
            .join("; ")
        : "No workflow runs were created.",
    },
    {
      key: "approval_gate",
      label: "Approval policy matched",
      passed:
        approvals.length >=
        (input.minimumApprovals ?? scenario.expectation.minimumApprovals),
      detail: `${approvals.length} approval${approvals.length === 1 ? "" : "s"} created; expected at least ${input.minimumApprovals ?? scenario.expectation.minimumApprovals}.`,
    },
  ];

  if (input.recordsContact ?? scenario.expectation.recordsContact) {
    const values = sanitizeLabValues(scenario, input.values);
    let contact: { id: string } | null = null;

    if (values.phone) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", input.clientId)
        .eq("phone", values.phone)
        .limit(1)
        .maybeSingle();
      contact = data;
    }

    if (!contact && values.email) {
      const { data } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("client_id", input.clientId)
        .eq("email", values.email)
        .limit(1)
        .maybeSingle();
      contact = data;
    }

    assertions.push({
      key: "crm_contact",
      label: "Built-in CRM recorded the contact",
      passed: Boolean(contact),
      detail: contact ? `Contact ${contact.id} found.` : "No matching contact found.",
    });
  }

  if (scenario.expectation.bookingProposal) {
    const booking = outputs
      .map(({ snapshot }) => snapshot.booking as Record<string, unknown> | undefined)
      .find(Boolean);

    assertions.push({
      key: "booking_proposed",
      label: "Sandbox calendar proposed a slot",
      passed: booking?.status === "proposed",
      detail: `Booking status: ${String(booking?.status ?? "missing")}.`,
    });
  }

  if (scenario.expectation.routingCategory) {
    const routing = outputs
      .map(({ output }) => output.routing as Record<string, unknown> | undefined)
      .find(Boolean);

    assertions.push({
      key: "routing_category",
      label: "Interaction routed correctly",
      passed: routing?.category === scenario.expectation.routingCategory,
      detail: `Routing category: ${String(routing?.category ?? "missing")}.`,
    });
  }

  if (scenario.expectation.urgency) {
    const analysis = outputs
      .map(({ output }) => output.analysis as Record<string, unknown> | undefined)
      .find(Boolean);

    assertions.push({
      key: "urgency",
      label: "Urgency threshold met",
      passed: atLeastUrgency(
        analysis?.urgency,
        scenario.expectation.urgency,
      ),
      detail: `Lead urgency: ${String(analysis?.urgency ?? "missing")}.`,
    });
  }

  const aiSources = outputs
    .map(({ snapshot }) => {
      const ai = snapshot.ai as Record<string, unknown> | null | undefined;
      return typeof ai?.status === "string" ? ai.status : null;
    })
    .filter((source): source is string => Boolean(source));

  return {
    assertions,
    approvalIds: approvals.map((approval) => approval.id),
    aiSources: [...new Set(aiSources)],
  };
}

async function executeScenario(
  admin: SupabaseClient,
  input: ScenarioRunInput,
): Promise<ScenarioLabRunResult> {
  const scenario = getLabScenario(input.scenarioKey);

  if (!scenario) {
    return { status: "error", message: "Choose a known test scenario." };
  }

  try {
    const execution =
      scenario.kind === "phone_transcript"
        ? await runPhoneTranscriptScenario(admin, input, scenario)
        : await runEventScenario(admin, input, scenario);
    const assertionResult = await buildAssertions(
      admin,
      input,
      scenario,
      execution.eventId,
      execution.runResults,
    );
    const passedAssertions = assertionResult.assertions.filter(
      (assertion) => assertion.passed,
    ).length;
    const passed = passedAssertions === assertionResult.assertions.length;
    const base = `/partner/clients/${input.clientId}`;

    return {
      status: "success",
      message: passed
        ? `${scenario.title} passed every assertion.`
        : `${scenario.title} exposed ${assertionResult.assertions.length - passedAssertions} failing assertion${assertionResult.assertions.length - passedAssertions === 1 ? "" : "s"}.`,
      scenarioKey: scenario.key,
      scenarioTitle: scenario.title,
      passed,
      passedAssertions,
      totalAssertions: assertionResult.assertions.length,
      eventId: execution.eventId,
      callSessionId: execution.callSessionId,
      runIds: execution.runResults.map((run) => run.runId),
      approvalIds: assertionResult.approvalIds,
      assertions: assertionResult.assertions,
      aiSources: assertionResult.aiSources,
      links: {
        runs: `${base}/runs`,
        approvals: `${base}/approvals`,
        crm: `${base}/crm`,
        assistant: `${base}/assistant`,
      },
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error ? error.message : "The scenario could not run.",
      scenarioKey: scenario.key,
      scenarioTitle: scenario.title,
    };
  }
}

export async function runScenarioLab(
  admin: SupabaseClient,
  input: ScenarioRunInput,
): Promise<ScenarioLabRunResult> {
  const client = await findScenarioLabClient(admin, input.partnerId);

  if (!client || client.id !== input.clientId) {
    return {
      status: "error",
      message: "Create the isolated scenario lab business before running tests.",
    };
  }

  const { count: liveConnections } = await admin
    .from("integration_connections")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("runtime_mode", "live");

  if ((liveConnections ?? 0) > 0) {
    return {
      status: "error",
      message:
        "The lab business has a live integration. Put it back in sandbox before running scenarios.",
    };
  }

  await ensureLabWorkflows(admin, input.partnerId, input.clientId);

  return executeScenario(admin, { ...input, source: "scenario_lab" });
}

export async function runClientLaunchScenario(
  admin: SupabaseClient,
  input: ScenarioRunInput,
): Promise<ScenarioLabRunResult> {
  const [{ count: liveConnections }, { count: liveWorkflows }] =
    await Promise.all([
      admin
        .from("integration_connections")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", input.partnerId)
        .eq("client_id", input.clientId)
        .eq("runtime_mode", "live"),
      admin
        .from("client_workflow_instances")
        .select("id", { count: "exact", head: true })
        .eq("partner_id", input.partnerId)
        .eq("client_id", input.clientId)
        .eq("runtime_mode", "live"),
    ]);

  if ((liveConnections ?? 0) > 0 || (liveWorkflows ?? 0) > 0) {
    return {
      status: "error",
      message:
        "Package tests cannot run while this client has live workflows or integrations. Roll back the active launch first.",
    };
  }

  return executeScenario(admin, { ...input, source: "launch_control" });
}
