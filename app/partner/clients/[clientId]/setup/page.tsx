import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  MonitorSmartphone,
  PlugZap,
  Rocket,
  Workflow,
} from "lucide-react";

import { EnablePackageWorkflowsButton } from "@/components/partner/enable-package-workflows-button";
import { LeadSourceWizard } from "@/components/partner/lead-source-wizard";
import {
  PackagePicker,
  type PackageOption,
} from "@/components/partner/package-picker";
import { PilotProviderCard } from "@/components/partner/pilot-provider-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import {
  emptyIntakeAnswers,
  type IntakeAnswers,
} from "@/lib/lead-sources/catalog";
import {
  PILOT_PROVIDERS,
  type PilotProviderKey,
} from "@/lib/integrations/pilot";
import { getAppUrl } from "@/lib/env";
import { googleRedirectUri } from "@/lib/integrations/providers/google-calendar";
import {
  enabledCapabilityKeys,
  STAFF_RUNTIME_LABELS,
  type IntegrationRequirement,
} from "@/lib/packages/capabilities";
import {
  requirementsForPackage,
  type PartnerPackageRecord,
} from "@/lib/packages/requirements";
import {
  missingIntegrationRequirements,
  type DeploymentReadinessConnection,
} from "@/lib/packages/deployment-readiness";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Setup",
};

export const dynamic = "force-dynamic";

// Messages for the ?google= outcome codes the OAuth callback redirects with.
const googleOutcomeMessages: Record<string, { ok: boolean; text: string }> = {
  connected: {
    ok: true,
    text: "Google Calendar is connected and verified with a live availability check.",
  },
  verify_failed: {
    ok: false,
    text: "Google authorized the connection, but the first availability check failed. Use Test connection to see the current error.",
  },
  denied: {
    ok: false,
    text: "Google authorization was cancelled or denied. Click Connect to try again.",
  },
  invalid_state: {
    ok: false,
    text: "The Google authorization link was expired or invalid. Start the connect flow again from this page.",
  },
  exchange_failed: {
    ok: false,
    text: "Google rejected the token exchange. Check the OAuth client ID, secret, and redirect URI, then try again.",
  },
  client_missing: {
    ok: false,
    text: "The stored OAuth client was missing. Enter the client ID and secret again.",
  },
  store_failed: {
    ok: false,
    text: "The Google credentials could not be stored. Try connecting again.",
  },
  sign_in_required: {
    ok: false,
    text: "Sign in first, then run the Google connect flow again.",
  },
  not_allowed: {
    ok: false,
    text: "Your role cannot manage integrations for this client.",
  },
  server_not_configured: {
    ok: false,
    text: "The server is missing its service configuration. See docs/13 for the required environment variables.",
  },
};

// Which connectable providers fulfil each requirement category today.
// Multiple entries mean "connect one of these" (e.g. either CRM).
const CATEGORY_TO_PILOT_PROVIDERS: Partial<Record<string, PilotProviderKey[]>> =
  {
    crm: ["hubspot", "gohighlevel"],
    sms: ["twilio"],
    phone: ["twilio"],
    email: ["resend"],
    calendar: ["google_calendar"],
  };

type PageProps = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ google?: string }>;
};

type ConnectionRow = {
  id: string;
  status: string;
  runtime_mode: string;
  credential_status: string;
  health_summary: string | null;
  last_success_at: string | null;
  provider: {
    provider_key: string;
    category: string;
    supports_inbound: boolean;
  } | null;
};

type PackageDeploymentRow = {
  id: string;
  package_id: string | null;
  package_name: string;
  status: "provisioning" | "needs_setup" | "ready" | "failed";
  provisioned_workflow_keys: string[];
  required_integration_ids: string[];
  missing_integration_ids: string[];
  bridge_connection_id: string | null;
  error_message: string | null;
  deployed_at: string | null;
  created_at: string;
};

const deploymentStatusMeta: Record<
  PackageDeploymentRow["status"],
  { label: string; className: string }
> = {
  provisioning: {
    label: "Provisioning",
    className: "border-sky-200 bg-sky-50 text-sky-800",
  },
  needs_setup: {
    label: "Connections needed",
    className: "border-amber-200 bg-amber-50 text-amber-900",
  },
  ready: {
    label: "Sandbox ready",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  failed: {
    label: "Deployment failed",
    className: "border-destructive/30 bg-destructive/5 text-destructive",
  },
};

function StepBadge({ done, label }: { done: boolean; label?: string }) {
  return done ? (
    <Badge
      variant="outline"
      className="border-emerald-200 bg-emerald-50 text-emerald-800"
    >
      <CircleCheck className="size-3" aria-hidden="true" />
      {label ?? "Done"}
    </Badge>
  ) : (
    <Badge
      variant="outline"
      className="border-amber-200 bg-amber-50 text-amber-900"
    >
      <CircleDashed className="size-3" aria-hidden="true" />
      {label ?? "Needs action"}
    </Badge>
  );
}

export default async function ClientSetupPage({
  params,
  searchParams,
}: PageProps) {
  const { clientId } = await params;
  const { google } = await searchParams;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { client, access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [
    { data: packagesData },
    { data: connectionsData },
    { data: instancesData },
    { data: deploymentData },
  ] = await Promise.all([
    supabase
      .from("partner_packages")
      .select("*")
      .eq("partner_id", client.partner_id)
      .eq("is_archived", false)
      .or(`client_id.is.null,client_id.eq.${clientId}`)
      .order("created_at", { ascending: true }),
    supabase
      .from("integration_connections")
      .select(
        "id, status, runtime_mode, credential_status, health_summary, last_success_at, provider:integration_providers(provider_key, category, supports_inbound)",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: true }),
    supabase
      .from("client_workflow_instances")
      .select("id, status, template:workflow_templates(template_key, name)")
      .eq("client_id", clientId),
    supabase
      .from("client_package_deployments")
      .select(
        "id, package_id, package_name, status, provisioned_workflow_keys, required_integration_ids, missing_integration_ids, bridge_connection_id, error_message, deployed_at, created_at",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const packages = (packagesData ?? []) as PartnerPackageRecord[];
  const connections = (connectionsData ?? []) as unknown as ConnectionRow[];
  const instances = (instancesData ?? []) as unknown as {
    id: string;
    status: string;
    template: { template_key: string; name: string } | null;
  }[];
  const latestDeployment =
    (deploymentData as PackageDeploymentRow | null) ?? null;

  const assignedPackage =
    packages.find((pkg) => pkg.id === client.package_id) ?? null;
  const requirements = assignedPackage
    ? requirementsForPackage(assignedPackage, {
        crmOperatingMode: client.crm_operating_mode,
      })
    : null;

  const options: PackageOption[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    capabilityKeys: enabledCapabilityKeys(pkg.capabilities),
    isCustomForThisClient: pkg.client_id === clientId,
  }));

  const profile =
    (client.lead_source_profile as {
      answers?: IntakeAnswers;
      saved_at?: string;
    } | null) ?? {};
  const savedAnswers = profile.answers;

  const activeConnectionByProviderKey = new Map<string, ConnectionRow>();

  for (const connection of connections) {
    const key = connection.provider?.provider_key;

    if (key && !activeConnectionByProviderKey.has(key)) {
      activeConnectionByProviderKey.set(key, connection);
    }
  }

  const enabledTemplateKeys = new Set(
    instances
      .filter((instance) => instance.status !== "disabled")
      .map((instance) => instance.template?.template_key)
      .filter(Boolean),
  );

  // Requirement rows for the checklist (lead_source handled separately).
  const integrationRequirements: IntegrationRequirement[] =
    requirements?.integrations.filter(
      (requirement) => requirement.id !== "lead_source",
    ) ?? [];
  const leadSourceRequired =
    requirements?.integrations.some(
      (requirement) => requirement.id === "lead_source",
    ) ?? false;

  const requiredTemplates = requirements
    ? requirements.workflowTemplateKeys.map((key) => {
        const instance = instances.find(
          (candidate) => candidate.template?.template_key === key,
        );

        return {
          key,
          name: instance?.template?.name ?? null,
          enabled: enabledTemplateKeys.has(key),
        };
      })
    : [];
  const allWorkflowsEnabled =
    requiredTemplates.length > 0 &&
    requiredTemplates.every((template) => template.enabled);

  const googleOutcome = google ? googleOutcomeMessages[google] : undefined;
  const base = `/partner/clients/${clientId}`;
  const deploymentStatus = latestDeployment
    ? deploymentStatusMeta[latestDeployment.status]
    : null;
  const connectableRequirements =
    requirements?.integrations.filter(
      (requirement) => requirement.connectableToday,
    ) ?? [];
  const missingRequirements = missingIntegrationRequirements(
    connectableRequirements,
    connections as unknown as DeploymentReadinessConnection[],
  );
  const missingRequirementIds = new Set(
    missingRequirements.map((requirement) => requirement.id),
  );
  const leadSourceReady =
    !leadSourceRequired || !missingRequirementIds.has("lead_source");
  const providerRequirements = integrationRequirements.filter(
    (requirement) => requirement.connectableToday,
  );
  const providerConnectionsReady = providerRequirements.every(
    (requirement) => !missingRequirementIds.has(requirement.id),
  );
  const packageProvisioned = Boolean(
    assignedPackage &&
    latestDeployment?.package_id === assignedPackage.id &&
    ["needs_setup", "ready"].includes(latestDeployment.status),
  );
  const workflowsReady = requiredTemplates.length === 0 || allWorkflowsEnabled;
  const connectionsReady =
    packageProvisioned && leadSourceReady && providerConnectionsReady;
  const setupReady =
    Boolean(assignedPackage) &&
    packageProvisioned &&
    connectionsReady &&
    workflowsReady;
  const completedConnectionCount =
    connectableRequirements.length - missingRequirements.length;
  const firstMissingRequirement = missingRequirements[0] ?? null;
  const setupBlockers = [
    !assignedPackage
      ? "Choose the package the client purchased."
      : !packageProvisioned
        ? "Provision the selected package in sandbox."
        : null,
    packageProvisioned && !leadSourceReady
      ? "Finish the lead intake connection."
      : null,
    packageProvisioned && !providerConnectionsReady
      ? `Connect ${missingRequirements
          .filter((requirement) => requirement.id !== "lead_source")
          .map((requirement) => requirement.label)
          .join(", ")}.`
      : null,
    packageProvisioned && !workflowsReady
      ? "Enable every workflow included in the package."
      : null,
  ].filter((item): item is string => Boolean(item));
  const nextAction =
    !assignedPackage || !packageProvisioned
      ? {
          href: "#provision",
          label: assignedPackage ? "Provision package" : "Choose a package",
          detail: assignedPackage
            ? "Create the sandbox workflows and connection plan."
            : "Start with exactly what the client purchased.",
        }
      : firstMissingRequirement
        ? {
            href: `${base}/connections`,
            label: `Connect ${firstMissingRequirement.label}`,
            detail:
              "Send the secure client setup link or connect the account here.",
          }
        : !workflowsReady
          ? {
              href: "#provision",
              label: "Enable package workflows",
              detail: "Turn on every workflow included in the package.",
            }
          : {
              href: `${base}/test-center`,
              label: "Open Test Center",
              detail: "Setup is complete. Run the guided package tests next.",
            };

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">Set up {client.name}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Provision the package, connect the client&apos;s accounts, review what
          staff need, then hand the finished setup to Test Center.
        </p>
      </header>

      {googleOutcome ? (
        <div
          className={
            googleOutcome.ok
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
              : "rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
          }
        >
          {googleOutcome.text}
        </div>
      ) : null}

      <section
        aria-label="Setup progress"
        className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2 xl:grid-cols-4"
      >
        {[
          {
            label: "1. Provision",
            detail: packageProvisioned
              ? (assignedPackage?.name ?? "Package ready")
              : "Package and workflows",
            done: packageProvisioned,
            icon: Workflow,
          },
          {
            label: "2. Connect",
            detail: `${completedConnectionCount}/${connectableRequirements.length} accounts ready`,
            done: connectionsReady,
            icon: PlugZap,
          },
          {
            label: "3. Install",
            detail:
              requirements?.staffRuntimes.length === 0
                ? "No staff install"
                : `${requirements?.staffRuntimes.length ?? 0} staff requirement${
                    requirements?.staffRuntimes.length === 1 ? "" : "s"
                  }`,
            done: Boolean(assignedPackage),
            icon: MonitorSmartphone,
          },
          {
            label: "4. Test",
            detail: setupReady ? "Ready to test" : "Waiting on setup",
            done: setupReady,
            icon: Rocket,
          },
        ].map((step, index) => {
          const Icon = step.icon;

          return (
            <div
              key={step.label}
              className={`flex min-w-0 items-center gap-3 px-4 py-4 ${
                index > 0 ? "border-t xl:border-l xl:border-t-0" : ""
              } ${index % 2 === 1 ? "sm:border-l" : ""} ${
                index >= 2 ? "sm:border-t" : "sm:border-t-0"
              }`}
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-md ${
                  step.done
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold">{step.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {step.detail}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      <section className="flex flex-col gap-3 border-l-4 border-primary bg-primary/5 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-muted-foreground">
            Next action
          </p>
          <p className="mt-1 font-semibold">{nextAction.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {nextAction.detail}
          </p>
        </div>
        <Button asChild className="shrink-0">
          <Link href={nextAction.href}>
            {nextAction.label}
            <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </Button>
      </section>

      <section id="provision" className="scroll-mt-20 border-t pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Step 1
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Provision the package
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Confirm what was sold and create its workflows in sandbox.
            </p>
          </div>
          <StepBadge
            done={packageProvisioned}
            label={
              packageProvisioned
                ? "Provisioned"
                : assignedPackage
                  ? "Provision required"
                  : "Package required"
            }
          />
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
          <div className="min-w-0">
            {assignedPackage ? (
              <div className="mb-4">
                <p className="font-semibold">{assignedPackage.name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {enabledCapabilityKeys(assignedPackage.capabilities).map(
                    (key) => (
                      <Badge key={key} variant="outline">
                        {requirements?.capabilities.find(
                          (capability) => capability.key === key,
                        )?.label ?? key}
                      </Badge>
                    ),
                  )}
                </div>
              </div>
            ) : null}

            <PackagePicker
              clientId={clientId}
              options={options}
              currentPackageId={client.package_id}
              canManage={access.canManageIntegrations}
              collapsedByDefault={packageProvisioned}
              currentPackageProvisioned={packageProvisioned}
            />

            {latestDeployment && deploymentStatus ? (
              <div className="mt-4 border-l-2 border-primary/40 pl-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">
                    Latest deployment: {latestDeployment.package_name}
                  </p>
                  <Badge
                    variant="outline"
                    className={deploymentStatus.className}
                  >
                    {deploymentStatus.label}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {latestDeployment.provisioned_workflow_keys.length} workflow
                  {latestDeployment.provisioned_workflow_keys.length === 1
                    ? ""
                    : "s"}{" "}
                  provisioned
                  {latestDeployment.bridge_connection_id
                    ? "; automation intake bridge ready"
                    : ""}
                  . Last run{" "}
                  {new Date(
                    latestDeployment.deployed_at ?? latestDeployment.created_at,
                  ).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                  .
                </p>
                {latestDeployment.error_message ? (
                  <p className="mt-1 text-xs text-destructive">
                    {latestDeployment.error_message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="border-l pl-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Included workflows</p>
              <StepBadge
                done={workflowsReady}
                label={workflowsReady ? "Enabled" : "Needs action"}
              />
            </div>
            {requiredTemplates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No automated workflows are included.
              </p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {requiredTemplates.map((template) => (
                  <li key={template.key} className="flex items-start gap-2">
                    {template.enabled ? (
                      <CircleCheck
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <CircleDashed
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                    <span>
                      {template.name ?? template.key.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {access.canManageWorkflows &&
            packageProvisioned &&
            !workflowsReady ? (
              <div className="mt-4">
                <EnablePackageWorkflowsButton
                  clientId={clientId}
                  label="Enable package workflows"
                />
              </div>
            ) : null}
            {requiredTemplates.length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Fine-tune enabled workflows under{" "}
                <Link href={`${base}/workflows`} className="underline">
                  Workflows
                </Link>
                .
              </p>
            ) : null}
          </div>
        </div>

        {requirements && requirements.limitations.length > 0 ? (
          <details className="mt-5 border-t pt-4 text-sm">
            <summary className="cursor-pointer font-medium text-muted-foreground">
              Current capability notes
            </summary>
            <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
              {requirements.limitations.map(({ capability, note }) => (
                <li key={capability.key}>
                  <span className="font-medium text-foreground">
                    {capability.label}:
                  </span>{" "}
                  {note}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section id="connections" className="scroll-mt-20 border-t pt-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Step 2
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Connect the client&apos;s accounts
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Open only the account you are connecting. Every provider stays in
              dry run until launch.
            </p>
          </div>
          <StepBadge
            done={connectionsReady}
            label={
              connectionsReady
                ? "All connected"
                : `${completedConnectionCount}/${connectableRequirements.length} ready`
            }
          />
        </div>

        {!packageProvisioned ? (
          <div className="mt-5 flex items-start gap-3 border border-dashed px-4 py-4 text-sm text-muted-foreground">
            <CircleAlert
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            Provision the package first. Its exact account requirements will
            appear here.
          </div>
        ) : requirements ? (
          <div className="mt-5 space-y-3">
            {leadSourceRequired ? (
              <details
                className="group overflow-hidden rounded-lg border bg-card"
                open={
                  !leadSourceReady &&
                  firstMissingRequirement?.id === "lead_source"
                }
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">Lead intake</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Choose where new leads enter the automation.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StepBadge
                      done={leadSourceReady}
                      label={
                        leadSourceReady
                          ? "Connected"
                          : savedAnswers
                            ? "Finish connection"
                            : "Needs action"
                      }
                    />
                    <ChevronDown
                      className="size-4 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </div>
                </summary>
                <div className="border-t p-4">
                  <LeadSourceWizard
                    clientId={client.id}
                    clientName={client.name}
                    initialAnswers={savedAnswers ?? emptyIntakeAnswers}
                    hasSavedPlan={Boolean(savedAnswers)}
                    canManage={access.canManageIntegrations}
                  />
                </div>
              </details>
            ) : null}

            {integrationRequirements.map((requirement) => {
              if (
                requirement.id === "phone" &&
                integrationRequirements.some((item) => item.id === "sms")
              ) {
                return null;
              }

              const pilotKeys = requirement.category
                ? (CATEGORY_TO_PILOT_PROVIDERS[requirement.category] ?? [])
                : [];

              if (pilotKeys.length > 0 && requirement.connectableToday) {
                const connectedKey = pilotKeys.find((key) =>
                  activeConnectionByProviderKey.has(key),
                );
                const keysToShow = connectedKey ? [connectedKey] : pilotKeys;
                const requirementReady = !missingRequirementIds.has(
                  requirement.id,
                );

                return (
                  <div key={requirement.id} className="space-y-3">
                    {keysToShow.map((pilotKey) => {
                      const meta = PILOT_PROVIDERS[pilotKey];
                      const connection =
                        activeConnectionByProviderKey.get(pilotKey) ?? null;
                      const connected = connection?.status === "connected";
                      const isAlternative =
                        keysToShow.length > 1 && pilotKey !== keysToShow[0];

                      return (
                        <details
                          key={pilotKey}
                          className="group overflow-hidden rounded-lg border bg-card"
                          open={
                            !requirementReady &&
                            firstMissingRequirement?.id === requirement.id &&
                            pilotKey === keysToShow[0]
                          }
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 [&::-webkit-details-marker]:hidden">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">
                                {meta.title}
                                {keysToShow.length > 1 ? (
                                  <span className="ml-1 font-normal text-muted-foreground">
                                    for {requirement.label}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {meta.tagline}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <StepBadge
                                done={connected}
                                label={
                                  connected
                                    ? "Connected"
                                    : isAlternative
                                      ? "Alternative"
                                      : "Needs action"
                                }
                              />
                              <ChevronDown
                                className="size-4 transition-transform group-open:rotate-180"
                                aria-hidden="true"
                              />
                            </div>
                          </summary>
                          <div className="border-t">
                            <PilotProviderCard
                              clientId={clientId}
                              meta={meta}
                              connection={
                                connection
                                  ? {
                                      id: connection.id,
                                      status: connection.status,
                                      runtime_mode: connection.runtime_mode,
                                      credential_status:
                                        connection.credential_status,
                                      health_summary: connection.health_summary,
                                      last_success_at:
                                        connection.last_success_at,
                                    }
                                  : null
                              }
                              oauthRedirectUri={
                                pilotKey === "google_calendar"
                                  ? googleRedirectUri()
                                  : undefined
                              }
                              inboundWebhookUrl={
                                pilotKey === "twilio" && connection
                                  ? `${getAppUrl()}/api/integrations/inbound/twilio/${connection.id}`
                                  : undefined
                              }
                              voiceWebhookUrl={
                                pilotKey === "twilio" && connection
                                  ? `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connection.id}`
                                  : undefined
                              }
                              voiceStatusUrl={
                                pilotKey === "twilio" && connection
                                  ? `${getAppUrl()}/api/integrations/inbound/twilio-voice/${connection.id}/status`
                                  : undefined
                              }
                              canManage={access.canManageIntegrations}
                              embedded
                            />
                          </div>
                        </details>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div
                  key={requirement.id}
                  className="flex flex-col gap-2 rounded-lg border border-dashed bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-semibold">{requirement.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {requirement.purpose} {requirement.recommended}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit border-slate-200 bg-slate-100 text-slate-600"
                  >
                    Manual setup
                  </Badge>
                </div>
              );
            })}
            {connectableRequirements.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                This package does not require provider connections.
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="border-t pt-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
            <MonitorSmartphone className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase text-muted-foreground">
              Step 3
            </p>
            <h3 className="mt-1 text-lg font-semibold">
              Review the staff install
            </h3>
            {!requirements ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Staff requirements appear after a package is selected.
              </p>
            ) : requirements.staffRuntimes.length === 0 ? (
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Nothing to install. This package runs in the background.
              </p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm leading-6">
                {requirements.staffRuntimes.map((runtime) => (
                  <li key={runtime}>
                    <span className="font-medium">
                      {STAFF_RUNTIME_LABELS[runtime].label}:
                    </span>{" "}
                    <span className="text-muted-foreground">
                      {STAFF_RUNTIME_LABELS[runtime].detail}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section
        className={`border-t px-4 pt-6 ${
          setupReady
            ? "border-emerald-300 bg-emerald-50/60"
            : "border-amber-200 bg-amber-50/50"
        } pb-5`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            {setupReady ? (
              <CircleCheck
                className="mt-0.5 size-5 shrink-0 text-emerald-700"
                aria-hidden="true"
              />
            ) : (
              <CircleDashed
                className="mt-0.5 size-5 shrink-0 text-amber-800"
                aria-hidden="true"
              />
            )}
            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground">
                Step 4
              </p>
              <h3 className="mt-1 font-semibold">
                {setupReady
                  ? "Ready for Test Center"
                  : "Finish setup before testing"}
              </h3>
              {setupReady ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  The package, accounts, and workflows are ready for guided
                  testing.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {setupBlockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {setupReady ? (
            <Button asChild className="shrink-0">
              <Link href={`${base}/test-center`}>
                Continue to Test Center
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          ) : (
            <Button disabled className="shrink-0">
              Test Center locked
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
