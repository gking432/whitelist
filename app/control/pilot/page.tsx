import Link from "next/link";
import { headers } from "next/headers";
import {
  Bot,
  Building2,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  Cloud,
  ExternalLink,
  Mail,
  MessageSquareText,
  Phone,
  PlugZap,
  ScrollText,
  Settings2,
  UserRoundCheck,
  Workflow,
} from "lucide-react";

import { startPlatformImpersonation } from "@/app/impersonation/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  classifyPilotAppUrl,
  selectFullPilotClient,
  type PilotClientCandidate,
  type PilotPackageSummary,
} from "@/lib/control/pilot";
import { getAppUrl, getSupabasePublicEnv } from "@/lib/env";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Real V1 Pilot" };
export const dynamic = "force-dynamic";

type ConnectionRow = {
  id: string;
  status: string;
  runtime_mode: string;
  credential_status: string;
  config: Record<string, unknown> | null;
  provider: {
    provider_key: string;
    display_name: string;
  } | null;
};

function StateBadge({ ready, label }: { ready: boolean; label?: string }) {
  return (
    <Badge
      variant="outline"
      className={
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-amber-200 bg-amber-50 text-amber-900"
      }
    >
      {ready ? (
        <CheckCircle2 className="size-3" aria-hidden="true" />
      ) : (
        <CircleDashed className="size-3" aria-hidden="true" />
      )}
      {label ?? (ready ? "Ready" : "Not ready")}
    </Badge>
  );
}

function ExternalAccountRow({
  icon: Icon,
  title,
  account,
  purpose,
  ready,
  status,
  href,
  actionLabel = "Open provider",
}: {
  icon: typeof Building2;
  title: string;
  account: string;
  purpose: string;
  ready: boolean;
  status: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <div className="grid gap-3 border-b px-4 py-4 last:border-b-0 sm:grid-cols-[2.3rem_minmax(0,1fr)_auto] sm:items-start sm:px-5">
      <div className="flex size-9 items-center justify-center rounded-md bg-secondary text-primary">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <StateBadge ready={ready} label={status} />
        </div>
        <p className="mt-1 text-sm leading-5">{account}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {purpose}
        </p>
      </div>
      {href ? (
        <Button
          asChild
          variant="outline"
          size="sm"
          className="w-full sm:w-auto"
        >
          <a href={href} target="_blank" rel="noreferrer">
            {actionLabel}
            <ExternalLink aria-hidden="true" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}

export default async function RealPilotPage() {
  const user = await requireAuthenticatedUser("/control/pilot");
  await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();

  if (!admin) return null;

  const [{ data: clientsData }, { data: packagesData }] = await Promise.all([
    admin
      .from("client_businesses")
      .select("id, partner_id, name, is_test_account, package_id")
      .eq("account_kind", "managed_client"),
    admin
      .from("partner_packages")
      .select("id, name, capabilities")
      .eq("is_archived", false),
  ]);

  const candidates = (clientsData ?? []).map((client) => ({
    id: client.id,
    partnerId: client.partner_id,
    name: client.name,
    isTestAccount: client.is_test_account,
    packageId: client.package_id,
  })) satisfies PilotClientCandidate[];
  const packages = (packagesData ?? []) as PilotPackageSummary[];
  const selected = selectFullPilotClient(candidates, packages);

  if (!selected) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-semibold">No full pilot business exists</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Create a test client and assign a package before running the real
          pilot.
        </p>
        <Button asChild variant="outline" className="mt-5">
          <Link href="/control">Back to Control Room</Link>
        </Button>
      </div>
    );
  }

  const [
    { data: partner },
    { data: connectionsData },
    { data: workflowsData },
    { data: testRunsData },
  ] = await Promise.all([
    admin
      .from("partners")
      .select("id, name, is_test_account")
      .eq("id", selected.client.partnerId)
      .maybeSingle(),
    admin
      .from("integration_connections")
      .select(
        "id, status, runtime_mode, credential_status, config, provider:integration_providers(provider_key, display_name)",
      )
      .eq("client_id", selected.client.id),
    admin
      .from("client_workflow_instances")
      .select("id, status")
      .eq("client_id", selected.client.id),
    admin
      .from("client_feature_test_runs")
      .select("capability_key, status, created_at")
      .eq("client_id", selected.client.id)
      .order("created_at", { ascending: false }),
  ]);

  if (!partner) return null;

  const connections = (connectionsData ?? []) as unknown as ConnectionRow[];
  const byProvider = new Map(
    connections
      .filter((connection) => connection.provider?.provider_key)
      .map((connection) => [connection.provider!.provider_key, connection]),
  );
  const connected = (...keys: string[]) =>
    keys.some((key) => byProvider.get(key)?.status === "connected");
  const connectionLabel = (...keys: string[]) => {
    const connection = keys.map((key) => byProvider.get(key)).find(Boolean);
    if (!connection) return "Not connected";
    if (connection.status !== "connected")
      return connection.status.replaceAll("_", " ");
    return connection.runtime_mode === "live"
      ? "Connected live"
      : "Connected sandbox";
  };
  const widgetConnection = byProvider.get("northstar_web_chat");
  const widgetKey =
    typeof widgetConnection?.config?.widget_public_key === "string"
      ? widgetConnection.config.widget_public_key
      : null;
  const appUrl = getAppUrl();
  const appUrlState = classifyPilotAppUrl(appUrl);
  const requestHeaders = await headers();
  const forwardedHost = (
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    ""
  )
    .split(",")[0]
    .trim();
  const forwardedProtocol = (requestHeaders.get("x-forwarded-proto") ?? "http")
    .split(",")[0]
    .trim();
  const requestOrigin =
    /^(https?|http)$/.test(forwardedProtocol) &&
    /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(forwardedHost)
      ? `${forwardedProtocol}://${forwardedHost}`
      : null;
  const widgetOrigin = appUrlState.ready ? appUrl : (requestOrigin ?? appUrl);
  const widgetUrl = widgetKey ? `${widgetOrigin}/widget/${widgetKey}` : null;
  const supabaseUrl = getSupabasePublicEnv()?.url ?? "";
  const cloudDatabase = /^https:\/\//.test(supabaseUrl);
  const workflowAi = Boolean(process.env.ANTHROPIC_API_KEY);
  const voiceAi =
    process.env.VOICE_PROVIDER === "openai_realtime" &&
    Boolean(process.env.OPENAI_API_KEY);
  const retryRunner = Boolean(process.env.CRON_SECRET);
  const activeWorkflowCount = (workflowsData ?? []).filter(
    (workflow) => workflow.status === "active",
  ).length;
  const latestTestByCapability = new Map<string, string>();

  for (const run of testRunsData ?? []) {
    if (!latestTestByCapability.has(run.capability_key)) {
      latestTestByCapability.set(run.capability_key, run.status);
    }
  }

  const passedFeatureCount = [...latestTestByCapability.values()].filter(
    (status) => status === "passed",
  ).length;
  const foundationChecks = [
    appUrlState.ready,
    cloudDatabase,
    workflowAi,
    voiceAi,
    retryRunner,
  ];
  const providerChecks = [
    connected("hubspot", "gohighlevel"),
    connected("twilio"),
    connected("google_calendar"),
    connected("resend"),
    connected("generic_inbound_webhook"),
    Boolean(widgetKey),
  ];
  const readyCount = [...foundationChecks, ...providerChecks].filter(
    Boolean,
  ).length;
  const totalReadyChecks = foundationChecks.length + providerChecks.length;
  const partnerInput = {
    targetKind: "partner" as const,
    targetId: partner.id,
    requestedMode: "sandbox_full" as const,
    returnPath: "/control/pilot",
  };

  return (
    <div className="min-w-0">
      <div className="space-y-6">
        <section className="border-b pb-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Badge variant="secondary">Pilot command center</Badge>
              <h1 className="mt-3 text-2xl font-semibold">
                Prove the whole V1
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                Use {selected.client.name} as the partner, client, and customer.
                Work top to bottom; every step names the real account, the
                action, and the evidence to inspect next.
              </p>
            </div>
            <div className="min-w-52 rounded-lg border bg-card p-4">
              <p className="text-xs font-medium text-muted-foreground">
                Real-pilot readiness
              </p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">
                {readyCount}/{totalReadyChecks}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.assignedPackage?.name ?? "No package"} ·{" "}
                {selected.capabilityKeys.length} capabilities ·{" "}
                {activeWorkflowCount} active workflows
              </p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <p className="text-xs font-semibold uppercase text-primary">
              Phase 1
            </p>
            <h2 className="mt-1 font-semibold">Make the environment real</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              External OAuth and webhooks should not be attached permanently
              until the app has a stable cloud URL.
            </p>
          </div>
          {[
            {
              icon: Cloud,
              title: "Stable deployed app",
              ready: appUrlState.ready,
              detail: `${appUrlState.label}: ${appUrlState.detail}`,
            },
            {
              icon: Building2,
              title: "Production database and auth",
              ready: cloudDatabase,
              detail: cloudDatabase
                ? "Supabase is using a hosted project."
                : "This preview is using local Supabase data.",
            },
            {
              icon: Bot,
              title: "Workflow and website-chat AI",
              ready: workflowAi,
              detail: workflowAi
                ? "Anthropic is configured."
                : "ANTHROPIC_API_KEY is missing; workflows use labeled rule-based fallback text.",
            },
            {
              icon: Phone,
              title: "Voice-agent AI",
              ready: voiceAi,
              detail: voiceAi
                ? "OpenAI Realtime is configured for browser/simulated calls."
                : "OPENAI_API_KEY and VOICE_PROVIDER=openai_realtime are required.",
            },
            {
              icon: Workflow,
              title: "Background retries",
              ready: retryRunner,
              detail: retryRunner
                ? "The job endpoint is protected and ready for a scheduler."
                : "CRON_SECRET is missing; automatic retries are not configured.",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.title}
                className="flex gap-3 border-b px-5 py-4 last:border-b-0"
              >
                <Icon
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <StateBadge ready={item.ready} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {item.detail}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase text-primary">
                Phase 2 · Partner
              </p>
              <h2 className="mt-1 font-semibold">
                Onboard the business and connect its accounts
              </h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Create one account per row. HubSpot and GoHighLevel are
                alternatives; start with HubSpot.
              </p>
            </div>
            <form
              action={startPlatformImpersonation.bind(null, {
                ...partnerInput,
                destination: `/partner/clients/${selected.client.id}/setup`,
              })}
            >
              <Button type="submit" size="sm">
                <Settings2 aria-hidden="true" />
                Onboard as partner
              </Button>
            </form>
          </div>
          <ExternalAccountRow
            icon={Building2}
            title="CRM"
            account="Create a HubSpot account and private app with contact read/write access. Use GoHighLevel only when the pilot specifically needs it."
            purpose="Proof: a customer interaction creates or updates the external contact and adds an AI Assistant note."
            ready={connected("hubspot", "gohighlevel")}
            status={connectionLabel("hubspot", "gohighlevel")}
            href="https://app.hubspot.com/signup-hubspot/crm"
          />
          <ExternalAccountRow
            icon={MessageSquareText}
            title="Business texting"
            account="Create a Twilio project, buy a number, and begin US A2P registration for the test business."
            purpose="Proof: text the number, approve the drafted reply as the client, and receive a real SMS."
            ready={connected("twilio")}
            status={connectionLabel("twilio")}
            href="https://console.twilio.com/"
          />
          <ExternalAccountRow
            icon={CalendarDays}
            title="Scheduling"
            account="Create a Google Cloud OAuth client, enable Calendar API, and authorize the test business calendar."
            purpose="Proof: Northstar reads free/busy time and creates the approved appointment in Google Calendar."
            ready={connected("google_calendar")}
            status={connectionLabel("google_calendar")}
            href="https://console.cloud.google.com/apis/credentials"
          />
          <ExternalAccountRow
            icon={Mail}
            title="Business email"
            account="Create a Resend account, verify a sending domain or subdomain, and create a sending API key."
            purpose="Proof: approve an email draft and receive it at the test customer address."
            ready={connected("resend")}
            status={connectionLabel("resend")}
            href="https://resend.com/domains"
          />
          <ExternalAccountRow
            icon={PlugZap}
            title="Automation bridge"
            account="Choose one: Zapier, Make, or n8n. Do not configure all three for the first pilot."
            purpose="Proof: send a form or CRM event into the generated Northstar webhook and inspect the resulting workflow."
            ready={connected("generic_inbound_webhook")}
            status={connectionLabel("generic_inbound_webhook")}
            href="https://zapier.com/app/signup"
          />
          <ExternalAccountRow
            icon={MessageSquareText}
            title="Website chat"
            account="No outside account is required. Enable the Northstar hosted widget during partner onboarding."
            purpose="Proof: chat as a customer, provide contact information, then find the interaction in CRM, approvals, and logs."
            ready={Boolean(widgetKey)}
            status={widgetKey ? "Widget ready" : "Not enabled"}
            href={widgetUrl ?? undefined}
            actionLabel="Open customer chat"
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-3">
          <div className="rounded-lg border bg-card p-5">
            <p className="text-xs font-semibold uppercase text-primary">
              Phase 3 · Client
            </p>
            <UserRoundCheck
              className="mt-4 size-5 text-primary"
              aria-hidden="true"
            />
            <h2 className="mt-3 font-semibold">Make the client decisions</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Review package tests, approve synthetic or real drafts, inspect
              CRM results, and verify activity from the business owner&apos;s
              view.
            </p>
            <form
              action={startPlatformImpersonation.bind(null, {
                targetKind: "client",
                targetId: selected.client.id,
                requestedMode: "sandbox_full",
                destination: "/client/test-center",
                returnPath: "/control/pilot",
              })}
              className="mt-4"
            >
              <Button type="submit" className="w-full">
                Act as client
              </Button>
            </form>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <p className="text-xs font-semibold uppercase text-primary">
              Phase 4 · Customer
            </p>
            <MessageSquareText
              className="mt-4 size-5 text-primary"
              aria-hidden="true"
            />
            <h2 className="mt-3 font-semibold">
              Use the real customer channels
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Chat through the widget, text the Twilio number, submit the bridge
              form, request a time, and receive the approved response.
            </p>
            {widgetUrl ? (
              <Button asChild variant="outline" className="mt-4 w-full">
                <a href={widgetUrl} target="_blank" rel="noreferrer">
                  Open customer chat
                  <ExternalLink aria-hidden="true" />
                </a>
              </Button>
            ) : (
              <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                Enable the website widget during partner onboarding to unlock
                the direct customer test.
              </p>
            )}
          </div>

          <div className="rounded-lg border bg-card p-5">
            <p className="text-xs font-semibold uppercase text-primary">
              Phase 5 · Partner
            </p>
            <ScrollText
              className="mt-4 size-5 text-primary"
              aria-hidden="true"
            />
            <h2 className="mt-3 font-semibold">Inspect the evidence</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Confirm inbound events, AI/rule output, approval ownership,
              external delivery, failures, and retry history without controlling
              the client&apos;s decisions.
            </p>
            <form
              action={startPlatformImpersonation.bind(null, {
                ...partnerInput,
                destination: `/partner/clients/${selected.client.id}/runs`,
              })}
              className="mt-4"
            >
              <Button type="submit" variant="outline" className="w-full">
                Open partner logs
              </Button>
            </form>
          </div>
        </section>

        <section className="rounded-lg border bg-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Current proof collected</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {passedFeatureCount}/{selected.capabilityKeys.length} package
                capabilities have a latest passing Test Center result. Synthetic
                evidence is useful, but a real pilot is complete only after the
                external provider can be inspected too.
              </p>
            </div>
            <StateBadge
              ready={passedFeatureCount === selected.capabilityKeys.length}
              label={`${passedFeatureCount}/${selected.capabilityKeys.length} passed`}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
