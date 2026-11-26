import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getAutomationPack,
  type AutomationPack,
} from "@/lib/automation-packs/catalog";
import {
  automationPackReadiness,
  type AutomationConnection,
} from "@/lib/automation-packs/readiness";

export const AUTOMATION_INSTALL_STATUSES = [
  "installing",
  "needs_setup",
  "ready_to_test",
  "active",
  "paused",
  "failed",
] as const;

export type AutomationInstallStatus =
  (typeof AUTOMATION_INSTALL_STATUSES)[number];

export type AutomationPackInstallRecord = {
  id: string;
  pack_key: string;
  pack_version: number;
  pack_name: string;
  status: AutomationInstallStatus;
  layer: AutomationPack["layer"];
  platforms: string[];
  workflow_template_keys: string[];
  required_connection_keys: string[];
  missing_connection_keys: string[];
  external_deployments: unknown[];
  verification_evidence: Record<string, unknown>;
  last_verified_at: string | null;
  last_error: string | null;
  installed_at: string;
};

type InstallInput = {
  partnerId: string;
  clientId: string;
  userId: string;
  packKey: string;
};

type TemplateRecord = {
  id: string;
  template_key: string;
  name: string;
  requires_approval_default: boolean;
  risk_level: "low" | "medium" | "high";
};

async function loadAutomationConnections(
  supabase: SupabaseClient,
  clientId: string,
): Promise<AutomationConnection[]> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id, status, provider:integration_providers(provider_key, category, supports_inbound)",
    )
    .eq("client_id", clientId)
    .neq("status", "disabled");

  if (error) {
    throw new Error("The client's connected accounts could not be loaded.");
  }

  return (data ?? []) as unknown as AutomationConnection[];
}

async function provisionPackWorkflows(
  supabase: SupabaseClient,
  input: InstallInput,
  pack: AutomationPack,
): Promise<{ created: number; templateKeys: string[] }> {
  if (pack.workflowTemplates.length === 0) {
    return { created: 0, templateKeys: [] };
  }

  const { data, error } = await supabase
    .from("workflow_templates")
    .select("id, template_key, name, requires_approval_default, risk_level")
    .in("template_key", pack.workflowTemplates)
    .eq("is_active", true);

  if (error) {
    throw new Error("The Northstar workflow catalog could not be loaded.");
  }

  const templates = (data ?? []) as TemplateRecord[];
  const found = new Set(templates.map((template) => template.template_key));
  const missing = pack.workflowTemplates.filter((key) => !found.has(key));

  if (missing.length > 0) {
    throw new Error(
      `Required Northstar workflows are unavailable: ${missing.join(", ")}.`,
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("client_workflow_instances")
    .select("id, template_id")
    .eq("client_id", input.clientId)
    .in(
      "template_id",
      templates.map((template) => template.id),
    );

  if (existingError) {
    throw new Error("Existing Northstar workflows could not be checked.");
  }

  const existingByTemplate = new Map(
    (existing ?? []).map((instance) => [instance.template_id, instance.id]),
  );
  const toCreate = templates.filter(
    (template) => !existingByTemplate.has(template.id),
  );

  if (toCreate.length > 0) {
    const { error: insertError } = await supabase
      .from("client_workflow_instances")
      .insert(
        toCreate.map((template) => ({
          partner_id: input.partnerId,
          client_id: input.clientId,
          template_id: template.id,
          name: template.name,
          status: "active",
          runtime_mode: "sandbox",
          settings: {
            provisioned_by: "automation_pack",
            automation_pack_key: pack.key,
            automation_pack_version: pack.version,
          },
          approval_policy: {
            requires_approval:
              template.requires_approval_default ||
              template.risk_level === "high",
          },
          health_status: "unknown",
          created_by: input.userId,
        })),
      );

    if (insertError) {
      throw new Error("The Northstar workflows could not be provisioned.");
    }
  }

  if ((existing ?? []).length > 0) {
    const { error: updateError } = await supabase
      .from("client_workflow_instances")
      .update({ status: "active" })
      .in(
        "id",
        (existing ?? []).map((instance) => instance.id),
      );

    if (updateError) {
      throw new Error("Existing Northstar workflows could not be activated.");
    }
  }

  return {
    created: toCreate.length,
    templateKeys: templates.map((template) => template.template_key),
  };
}

export async function installAutomationPackForClient(
  supabase: SupabaseClient,
  input: InstallInput,
): Promise<{
  install: AutomationPackInstallRecord;
  createdWorkflowCount: number;
  missingConnectionLabels: string[];
}> {
  const pack = getAutomationPack(input.packKey);

  if (!pack) {
    throw new Error("That automation pack does not exist.");
  }

  if (pack.launchScope !== "v1") {
    throw new Error("That automation pack is not available for installation yet.");
  }

  const { data: client, error: clientError } = await supabase
    .from("client_businesses")
    .select("id, crm_operating_mode")
    .eq("id", input.clientId)
    .eq("partner_id", input.partnerId)
    .maybeSingle();

  if (clientError || !client) {
    throw new Error("The client was not found.");
  }

  const installedAt = new Date().toISOString();
  const baseRecord = {
    partner_id: input.partnerId,
    client_id: input.clientId,
    pack_key: pack.key,
    pack_version: pack.version,
    pack_name: pack.name,
    status: "installing",
    layer: pack.layer,
    platforms: pack.platforms,
    workflow_template_keys: pack.workflowTemplates,
    required_connection_keys: pack.connectionRequirements.map(
      (requirement) => requirement.key,
    ),
    missing_connection_keys: [],
    external_deployments: [],
    verification_evidence: {},
    last_verified_at: null,
    last_error: null,
    installed_by: input.userId,
    installed_at: installedAt,
  };
  const { data: started, error: startError } = await supabase
    .from("client_automation_pack_installs")
    .upsert(baseRecord, { onConflict: "client_id,pack_key" })
    .select("id")
    .single();

  if (startError || !started) {
    throw new Error("The automation installation could not be started.");
  }

  try {
    const [workflowResult, connections] = await Promise.all([
      provisionPackWorkflows(supabase, input, pack),
      loadAutomationConnections(supabase, input.clientId),
    ]);
    const readiness = automationPackReadiness(pack, connections, {
      crmOperatingMode: client.crm_operating_mode,
    });
    const status: AutomationInstallStatus = readiness.ready
      ? "ready_to_test"
      : "needs_setup";
    const { data: finished, error: finishError } = await supabase
      .from("client_automation_pack_installs")
      .update({
        status,
        workflow_template_keys: workflowResult.templateKeys,
        missing_connection_keys: readiness.missingKeys,
        last_error: null,
      })
      .eq("id", started.id)
      .select("*")
      .single();

    if (finishError || !finished) {
      throw new Error("The automation installation result could not be saved.");
    }

    return {
      install: finished as AutomationPackInstallRecord,
      createdWorkflowCount: workflowResult.created,
      missingConnectionLabels: readiness.missingLabels,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Automation installation failed.";

    await supabase
      .from("client_automation_pack_installs")
      .update({ status: "failed", last_error: message })
      .eq("id", started.id);

    throw error;
  }
}

export async function verifyAutomationPackForClient(
  supabase: SupabaseClient,
  input: Omit<InstallInput, "userId">,
): Promise<{ install: AutomationPackInstallRecord; eventType: string }> {
  const pack = getAutomationPack(input.packKey);

  if (!pack) {
    throw new Error("That automation pack does not exist.");
  }

  const { data: install, error: installError } = await supabase
    .from("client_automation_pack_installs")
    .select("*")
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("pack_key", input.packKey)
    .maybeSingle();

  if (installError || !install) {
    throw new Error("Install this automation pack before verifying it.");
  }

  if (install.missing_connection_keys?.length > 0) {
    throw new Error("Connect the required accounts, then install the pack again.");
  }

  let eventQuery = supabase
    .from("integration_events")
    .select("id, event_type, workflow_run_id, created_at")
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .eq("status", "processed")
    .in("event_type", pack.verificationEventTypes)
    .gte("created_at", install.installed_at)
    .order("created_at", { ascending: false })
    .limit(1);

  if (pack.workflowTemplates.length > 0) {
    eventQuery = eventQuery.not("workflow_run_id", "is", null);
  }

  const { data: events, error: eventError } = await eventQuery;
  const event = events?.[0] ?? null;

  if (eventError || !event) {
    throw new Error(
      `No real ${pack.name} event has completed since installation. Run the test steps, then verify again.`,
    );
  }

  const verifiedAt = new Date().toISOString();
  const { data: verified, error: verifyError } = await supabase
    .from("client_automation_pack_installs")
    .update({
      status: "active",
      last_verified_at: verifiedAt,
      last_error: null,
      verification_evidence: {
        event_id: event.id,
        event_type: event.event_type,
        workflow_run_id: event.workflow_run_id,
        event_created_at: event.created_at,
      },
    })
    .eq("id", install.id)
    .select("*")
    .single();

  if (verifyError || !verified) {
    throw new Error("The verification result could not be saved.");
  }

  return {
    install: verified as AutomationPackInstallRecord,
    eventType: event.event_type,
  };
}
