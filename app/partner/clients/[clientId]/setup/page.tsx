import Link from "next/link";
import { CircleCheck, CircleDashed, MonitorSmartphone } from "lucide-react";

import { EnablePackageWorkflowsButton } from "@/components/partner/enable-package-workflows-button";
import { LeadSourceWizard } from "@/components/partner/lead-source-wizard";
import {
  PackagePicker,
  type PackageOption,
} from "@/components/partner/package-picker";
import { PilotProviderCard } from "@/components/partner/pilot-provider-card";
import { TestLeadButton } from "@/components/partner/test-lead-button";
import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import {
  emptyIntakeAnswers,
  type IntakeAnswers,
} from "@/lib/lead-sources/catalog";
import { PILOT_PROVIDERS, type PilotProviderKey } from "@/lib/integrations/pilot";
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
const CATEGORY_TO_PILOT_PROVIDERS: Partial<
  Record<string, PilotProviderKey[]>
> = {
  crm: ["hubspot", "gohighlevel"],
  sms: ["twilio"],
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
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-900">
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

  const [{ data: packagesData }, { data: connectionsData }, { data: instancesData }] =
    await Promise.all([
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
    ]);

  const packages = (packagesData ?? []) as PartnerPackageRecord[];
  const connections = (connectionsData ?? []) as unknown as ConnectionRow[];
  const instances = (instancesData ?? []) as unknown as {
    id: string;
    status: string;
    template: { template_key: string; name: string } | null;
  }[];

  const assignedPackage =
    packages.find((pkg) => pkg.id === client.package_id) ?? null;
  const requirements = assignedPackage
    ? requirementsForPackage(assignedPackage)
    : null;

  const options: PackageOption[] = packages.map((pkg) => ({
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    capabilityKeys: enabledCapabilityKeys(pkg.capabilities),
    isCustomForThisClient: pkg.client_id === clientId,
  }));

  // Lead intake status: any inbound-capable connection, or at least a saved
  // wizard plan.
  const hasInboundConnection = connections.some(
    (connection) =>
      connection.provider?.supports_inbound &&
      connection.status !== "disabled",
  );
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

  const connectedCategories = new Set(
    connections
      .filter((connection) =>
        ["connected", "needs_attention"].includes(connection.status),
      )
      .map((connection) => connection.provider?.category)
      .filter(Boolean),
  );

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

  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Setup for {client.name}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Pick the package you sold, and Northstar turns it into a concrete
          checklist: what to connect, which workflows to enable, what (if
          anything) the client&apos;s staff need installed, and what to test
          before go-live.
        </p>
      </section>

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

      {/* Step 1 — package */}
      <section className="rounded-lg border bg-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">1. Which package did you sell?</h3>
          <StepBadge
            done={Boolean(assignedPackage)}
            label={assignedPackage ? assignedPackage.name : "Choose a package"}
          />
        </div>
        {assignedPackage ? (
          <div className="mt-3">
            <div className="flex flex-wrap gap-1.5">
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
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Change package or create a custom one
              </summary>
              <div className="mt-3">
                <PackagePicker
                  clientId={clientId}
                  options={options}
                  currentPackageId={client.package_id}
                  canManage={access.canManageIntegrations}
                />
              </div>
            </details>
          </div>
        ) : (
          <div className="mt-4">
            <PackagePicker
              clientId={clientId}
              options={options}
              currentPackageId={client.package_id}
              canManage={access.canManageIntegrations}
            />
          </div>
        )}
      </section>

      {assignedPackage && requirements ? (
        <>
          {/* Honest limits for what was sold */}
          {requirements.limitations.length > 0 ? (
            <section className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-sm font-semibold text-sky-900">
                Sold ahead of the product — what works today
              </p>
              <ul className="mt-1.5 space-y-1 text-sm leading-5 text-sky-900/90">
                {requirements.limitations.map(({ capability, note }) => (
                  <li key={capability.key}>
                    <span className="font-medium">{capability.label}:</span>{" "}
                    {note}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Step 2 — lead intake */}
          {leadSourceRequired ? (
            <section className="rounded-lg border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">2. Set up the lead intake</h3>
                <StepBadge
                  done={hasInboundConnection}
                  label={
                    hasInboundConnection
                      ? "Intake connected"
                      : savedAnswers
                        ? "Plan saved — finish connecting"
                        : "Needs action"
                  }
                />
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Where this client&apos;s leads come from. Use the wizard at
                the bottom of this page — it asks plain questions and creates
                the intake connection for you.{" "}
                <a href="#lead-source-wizard" className="underline">
                  Jump to the lead source wizard
                </a>
                .
              </p>
            </section>
          ) : null}

          {/* Step 3 — required integrations */}
          <section className="space-y-4">
            <div className="rounded-lg border bg-card p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">
                  {leadSourceRequired ? "3" : "2"}. Connect the required
                  integrations
                </h3>
                <StepBadge
                  done={integrationRequirements
                    .filter((requirement) => requirement.connectableToday)
                    .every((requirement) =>
                      connectedCategories.has(requirement.category ?? ""),
                    )}
                />
              </div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Only what this package needs. Every connection starts in dry
                run — nothing real is sent until you switch it to live.
              </p>
              {integrationRequirements.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  This package needs no provider connections beyond the lead
                  intake.
                </p>
              ) : null}
            </div>

            {integrationRequirements.map((requirement) => {
              const pilotKeys = requirement.category
                ? (CATEGORY_TO_PILOT_PROVIDERS[requirement.category] ?? [])
                : [];

              if (pilotKeys.length > 0 && requirement.connectableToday) {
                // If one option in the group is already connected, show only
                // that one; otherwise offer every option ("connect one").
                const connectedKey = pilotKeys.find((key) =>
                  activeConnectionByProviderKey.has(key),
                );
                const keysToShow = connectedKey ? [connectedKey] : pilotKeys;

                return (
                  <div key={requirement.id} className="space-y-4">
                    {keysToShow.length > 1 ? (
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {requirement.label}: connect one of the following
                      </p>
                    ) : null}
                    {keysToShow.map((pilotKey) => {
                      const meta = PILOT_PROVIDERS[pilotKey];
                      const connection =
                        activeConnectionByProviderKey.get(pilotKey) ?? null;

                      return (
                        <PilotProviderCard
                          key={pilotKey}
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
                                  last_success_at: connection.last_success_at,
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
                          canManage={access.canManageIntegrations}
                        />
                      );
                    })}
                  </div>
                );
              }

              return (
                <section
                  key={requirement.id}
                  className="rounded-lg border border-dashed bg-card p-6"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="font-semibold">{requirement.label}</h4>
                    <Badge
                      variant="outline"
                      className="border-slate-200 bg-slate-100 text-slate-600"
                    >
                      No adapter yet
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {requirement.purpose} {requirement.recommended}
                  </p>
                </section>
              );
            })}
          </section>

          {/* Step 4 — workflows */}
          <section className="rounded-lg border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">
                {leadSourceRequired ? "4" : "3"}. Enable the included workflows
              </h3>
              <StepBadge
                done={allWorkflowsEnabled || requiredTemplates.length === 0}
                label={
                  requiredTemplates.length === 0
                    ? "None needed"
                    : allWorkflowsEnabled
                      ? "All enabled"
                      : "Needs action"
                }
              />
            </div>
            {requiredTemplates.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                This package includes no automated workflows.
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {requiredTemplates.map((template) => (
                    <li
                      key={template.key}
                      className="flex items-center gap-2"
                    >
                      {template.enabled ? (
                        <CircleCheck
                          className="size-4 text-emerald-600"
                          aria-hidden="true"
                        />
                      ) : (
                        <CircleDashed
                          className="size-4 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <span>
                        {template.name ??
                          template.key.replaceAll("_", " ")}
                      </span>
                    </li>
                  ))}
                </ul>
                {access.canManageWorkflows && !allWorkflowsEnabled ? (
                  <div className="mt-4">
                    <EnablePackageWorkflowsButton
                      clientId={clientId}
                      label="Enable this package's workflows"
                    />
                  </div>
                ) : null}
                <p className="mt-3 text-xs text-muted-foreground">
                  Workflows start in their safe default mode with approvals
                  on. Fine-tune each one under{" "}
                  <Link href={`${base}/workflows`} className="underline">
                    Workflows
                  </Link>
                  .
                </p>
              </>
            )}
          </section>

          {/* Step 5 — staff runtime */}
          <section className="rounded-lg border bg-card p-6">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MonitorSmartphone className="size-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold">
                  What the client&apos;s staff need to run
                </h3>
                {requirements.staffRuntimes.length === 0 ? (
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Nothing. This package runs entirely in the background — no
                    desktop app, no browser extension, no installs.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm leading-6">
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
                {!requirements.staffRuntimes.includes(
                  "browser_extension_or_desktop",
                ) ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No desktop app is required for this package.
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {/* Step 6 — test */}
          <section className="rounded-lg border bg-card p-6">
            <h3 className="font-semibold">Run a test lead before go-live</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Fire a realistic sample lead through the real pipeline and watch
              it move: AI analysis, a customer-facing draft, and the built-in
              CRM entry. Nothing real is sent — every connection stays in dry
              run until you switch it to live, so this is safe to run now with
              nothing connected. Once you connect a provider and go live, the
              same approve button actually sends.
            </p>
            {access.canManageWorkflows ? (
              <div className="mt-4">
                <TestLeadButton clientId={clientId} />
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                Your role can view results but not fire test leads.
              </p>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              After it runs you&apos;ll land on the run detail. Also check{" "}
              <Link href={`${base}/approvals`} className="underline">
                Approvals
              </Link>{" "}
              for the waiting draft and{" "}
              <Link href={`${base}/crm`} className="underline">
                CRM
              </Link>{" "}
              for the new contact. Prefer curl? The manual script is in{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                docs/13-real-world-pilot-test-plan.md
              </code>
              .
            </p>
          </section>
        </>
      ) : (
        <section className="rounded-lg border border-dashed bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Choose a package above and the rest of the checklist appears:
            required integrations, workflow packs, staff installs, and the
            go-live test.
          </p>
        </section>
      )}

      {assignedPackage && leadSourceRequired ? (
        <div id="lead-source-wizard">
          <LeadSourceWizard
            clientId={client.id}
            clientName={client.name}
            initialAnswers={savedAnswers ?? emptyIntakeAnswers}
            hasSavedPlan={Boolean(savedAnswers)}
            canManage={access.canManageIntegrations}
          />
        </div>
      ) : null}
    </div>
  );
}
