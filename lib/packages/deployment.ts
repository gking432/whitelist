import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import {
  encryptSecret,
  generateWebhookToken,
  isSecretsEncryptionConfigured,
  secretLastFour,
} from "@/lib/integrations/secrets";
import {
  INBOUND_WEBHOOK_PROVIDER_KEY,
  inboundWebhookPath,
} from "@/lib/integrations/types";
import {
  integrationRequirementIsMet,
  missingIntegrationRequirements,
  type DeploymentReadinessConnection,
} from "@/lib/packages/deployment-readiness";
import {
  requirementsForPackage,
  type PartnerPackageRecord,
} from "@/lib/packages/requirements";

const BRIDGE_EVENT_TYPES = [
  "lead.created",
  "form.submitted",
  "email.lead_received",
  "sms.received",
  "call.completed",
  "manual.lead_created",
];

export type DeploymentConnection = DeploymentReadinessConnection;

export type PackageDeploymentSummary = {
  id: string;
  packageId: string;
  packageName: string;
  status: "ready" | "needs_setup";
  provisionedWorkflowKeys: string[];
  createdWorkflowCount: number;
  requiredIntegrationIds: string[];
  missingIntegrationIds: string[];
  missingIntegrationLabels: string[];
  bridge: {
    connectionId: string;
    endpointUrl: string;
    oneTimeToken?: string;
  } | null;
};

type DeployInput = {
  partnerId: string;
  clientId: string;
  packageId: string;
  userId: string;
};

async function loadConnections(
  supabase: SupabaseClient,
  clientId: string,
): Promise<DeploymentConnection[]> {
  const { data, error } = await supabase
    .from("integration_connections")
    .select(
      "id, status, provider:integration_providers(provider_key, category, supports_inbound)",
    )
    .eq("client_id", clientId)
    .neq("status", "disabled");

  if (error) {
    throw new Error("The client's integration state could not be loaded.");
  }

  return (data ?? []) as unknown as DeploymentConnection[];
}

async function ensureAutomationBridge(
  supabase: SupabaseClient,
  input: DeployInput,
  packageName: string,
  connections: DeploymentConnection[],
) {
  const existing = connections.find(
    (connection) =>
      connection.provider?.provider_key === INBOUND_WEBHOOK_PROVIDER_KEY &&
      connection.status !== "disabled",
  );

  if (existing) {
    return {
      connection: existing,
      bridge: {
        connectionId: existing.id,
        endpointUrl: `${getAppUrl()}${inboundWebhookPath(existing.id)}`,
      },
    };
  }

  if (!isSecretsEncryptionConfigured()) {
    return { connection: null, bridge: null };
  }

  const { data: provider, error: providerError } = await supabase
    .from("integration_providers")
    .select("id, provider_key, category, supports_inbound")
    .eq("provider_key", INBOUND_WEBHOOK_PROVIDER_KEY)
    .eq("is_active", true)
    .maybeSingle();

  if (providerError || !provider) {
    throw new Error("The automation bridge provider is unavailable.");
  }

  const { data: created, error: connectionError } = await supabase
    .from("integration_connections")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      provider_id: provider.id,
      display_name: `${packageName} intake bridge`,
      status: "connected",
      runtime_mode: "sandbox",
      credential_status: "configured",
      config: {
        source: "package_deployment",
        package_id: input.packageId,
        compatible_platforms: ["zapier", "n8n", "make"],
        accepted_event_types: BRIDGE_EVENT_TYPES,
      },
      health_summary: "Waiting for the first Zapier, n8n, or Make event.",
      created_by: input.userId,
    })
    .select("id")
    .single();

  if (connectionError || !created) {
    throw new Error("The package intake bridge could not be created.");
  }

  const token = generateWebhookToken();
  const { error: secretError } = await supabase
    .from("integration_secrets")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: created.id,
      secret_kind: "webhook_token",
      encrypted_value: encryptSecret(token),
      last_four: secretLastFour(token),
    });

  if (secretError) {
    await supabase
      .from("integration_connections")
      .delete()
      .eq("id", created.id);
    throw new Error("The package intake credential could not be stored.");
  }

  const connection: DeploymentConnection = {
    id: created.id,
    status: "connected",
    provider: {
      provider_key: provider.provider_key,
      category: provider.category,
      supports_inbound: provider.supports_inbound,
    },
  };

  return {
    connection,
    bridge: {
      connectionId: created.id,
      endpointUrl: `${getAppUrl()}${inboundWebhookPath(created.id)}`,
      oneTimeToken: token,
    },
  };
}

export async function deployPackageToClient(
  supabase: SupabaseClient,
  input: DeployInput,
): Promise<PackageDeploymentSummary> {
  const [{ data: client }, { data: packageData }] = await Promise.all([
    supabase
      .from("client_businesses")
      .select("id, name, crm_operating_mode")
      .eq("id", input.clientId)
      .eq("partner_id", input.partnerId)
      .maybeSingle(),
    supabase
      .from("partner_packages")
      .select("*")
      .eq("id", input.packageId)
      .eq("partner_id", input.partnerId)
      .eq("is_archived", false)
      .maybeSingle(),
  ]);

  const pkg = packageData as PartnerPackageRecord | null;

  if (!client) {
    throw new Error("The client was not found.");
  }

  if (!pkg || (pkg.client_id && pkg.client_id !== input.clientId)) {
    throw new Error("That package is not available for this client.");
  }

  const requirements = requirementsForPackage(pkg, {
    crmOperatingMode: client.crm_operating_mode,
  });
  const requiredIntegrationIds = requirements.integrations.map(
    (requirement) => requirement.id,
  );
  const { data: deployment, error: deploymentError } = await supabase
    .from("client_package_deployments")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      package_id: pkg.id,
      package_name: pkg.name,
      status: "provisioning",
      capabilities_snapshot: pkg.capabilities,
      workflow_template_keys: requirements.workflowTemplateKeys,
      required_integration_ids: requiredIntegrationIds,
      deployed_by: input.userId,
    })
    .select("id")
    .single();

  if (deploymentError || !deployment) {
    throw new Error("The package deployment could not be started.");
  }

  try {
    const { data: templates, error: templateError } =
      requirements.workflowTemplateKeys.length > 0
        ? await supabase
            .from("workflow_templates")
            .select(
              "id, template_key, name, requires_approval_default, risk_level",
            )
            .in("template_key", requirements.workflowTemplateKeys)
            .eq("is_active", true)
        : { data: [], error: null };

    if (templateError) {
      throw new Error("The package workflow catalog could not be loaded.");
    }

    const templateKeys = new Set(
      (templates ?? []).map((template) => template.template_key),
    );
    const missingTemplates = requirements.workflowTemplateKeys.filter(
      (key) => !templateKeys.has(key),
    );

    if (missingTemplates.length > 0) {
      throw new Error(
        `The package references unavailable workflows: ${missingTemplates.join(", ")}.`,
      );
    }

    const templateIds = (templates ?? []).map((template) => template.id);
    const { data: existing, error: existingError } = templateIds.length
      ? await supabase
          .from("client_workflow_instances")
          .select("id, template_id")
          .eq("client_id", input.clientId)
          .in("template_id", templateIds)
      : { data: [], error: null };

    if (existingError) {
      throw new Error("The client's current workflows could not be loaded.");
    }

    const existingByTemplate = new Map(
      (existing ?? []).map((instance) => [instance.template_id, instance.id]),
    );
    const toCreate = (templates ?? []).filter(
      (template) => !existingByTemplate.has(template.id),
    );

    if (toCreate.length > 0) {
      const { error } = await supabase.from("client_workflow_instances").insert(
        toCreate.map((template) => ({
          partner_id: input.partnerId,
          client_id: input.clientId,
          template_id: template.id,
          name: template.name,
          status: "active",
          runtime_mode: "sandbox",
          settings: {
            provisioned_by: "package_deployment",
            package_id: pkg.id,
            deployment_id: deployment.id,
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

      if (error) {
        throw new Error("The package workflows could not be provisioned.");
      }
    }

    if ((existing ?? []).length > 0) {
      const { error } = await supabase
        .from("client_workflow_instances")
        .update({ status: "active", runtime_mode: "sandbox" })
        .in(
          "id",
          (existing ?? []).map((instance) => instance.id),
        );

      if (error) {
        throw new Error("The existing package workflows could not be activated.");
      }
    }

    const approvalTemplateIds = (templates ?? [])
      .filter(
        (template) =>
          template.requires_approval_default || template.risk_level === "high",
      )
      .map((template) => template.id);

    if (approvalTemplateIds.length > 0) {
      const { error } = await supabase
        .from("client_workflow_instances")
        .update({ approval_policy: { requires_approval: true } })
        .eq("client_id", input.clientId)
        .in("template_id", approvalTemplateIds);

      if (error) {
        throw new Error("The package approval gates could not be enforced.");
      }
    }

    let connections = await loadConnections(supabase, input.clientId);
    let bridge: PackageDeploymentSummary["bridge"] = null;
    const needsLeadSource = requirements.integrations.some(
      (requirement) => requirement.id === "lead_source",
    );

    if (
      needsLeadSource &&
      !requirements.integrations
        .filter((requirement) => requirement.id === "lead_source")
        .every((requirement) =>
          integrationRequirementIsMet(requirement, connections),
        )
    ) {
      const ensured = await ensureAutomationBridge(
        supabase,
        input,
        pkg.name,
        connections,
      );
      bridge = ensured.bridge;

      if (ensured.connection) {
        connections = [...connections, ensured.connection];
      }
    } else {
      const existingBridge = connections.find(
        (connection) =>
          connection.provider?.provider_key === INBOUND_WEBHOOK_PROVIDER_KEY,
      );

      if (existingBridge) {
        bridge = {
          connectionId: existingBridge.id,
          endpointUrl: `${getAppUrl()}${inboundWebhookPath(existingBridge.id)}`,
        };
      }
    }

    const missingRequirements = missingIntegrationRequirements(
      requirements.integrations,
      connections,
    );
    const status = missingRequirements.length === 0 ? "ready" : "needs_setup";
    const deployedAt = new Date().toISOString();

    const { error: assignmentError } = await supabase
      .from("client_businesses")
      .update({ package_id: pkg.id })
      .eq("id", input.clientId)
      .eq("partner_id", input.partnerId);

    if (assignmentError) {
      throw new Error("The provisioned package could not be assigned.");
    }

    const { error: finishError } = await supabase
      .from("client_package_deployments")
      .update({
        status,
        provisioned_workflow_keys: requirements.workflowTemplateKeys,
        missing_integration_ids: missingRequirements.map(
          (requirement) => requirement.id,
        ),
        bridge_connection_id: bridge?.connectionId ?? null,
        deployed_at: deployedAt,
        error_message: null,
      })
      .eq("id", deployment.id);

    if (finishError) {
      throw new Error("The package deployment result could not be recorded.");
    }

    return {
      id: deployment.id,
      packageId: pkg.id,
      packageName: pkg.name,
      status,
      provisionedWorkflowKeys: requirements.workflowTemplateKeys,
      createdWorkflowCount: toCreate.length,
      requiredIntegrationIds,
      missingIntegrationIds: missingRequirements.map(
        (requirement) => requirement.id,
      ),
      missingIntegrationLabels: missingRequirements.map(
        (requirement) => requirement.label,
      ),
      bridge,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The package deployment failed.";

    await supabase
      .from("client_package_deployments")
      .update({ status: "failed", error_message: message })
      .eq("id", deployment.id);

    throw error;
  }
}
