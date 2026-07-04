import Link from "next/link";
import { Rocket } from "lucide-react";

import {
  PilotProviderCard,
  type PilotConnectionSummary,
} from "@/components/partner/pilot-provider-card";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import {
  PILOT_PROVIDER_KEYS,
  PILOT_PROVIDERS,
  type PilotProviderKey,
} from "@/lib/integrations/pilot";
import { googleRedirectUri } from "@/lib/integrations/providers/google-calendar";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Pilot Stack",
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

type PageProps = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ google?: string }>;
};

type ConnectionRow = PilotConnectionSummary & {
  provider: { provider_key: string } | null;
};

export default async function PilotStackPage({ params, searchParams }: PageProps) {
  const { clientId } = await params;
  const { google } = await searchParams;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("integration_connections")
    .select(
      "id, status, runtime_mode, credential_status, health_summary, last_success_at, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", clientId)
    .in("provider.provider_key", [...PILOT_PROVIDER_KEYS])
    .order("created_at", { ascending: true });

  const connections = (data ?? []) as unknown as ConnectionRow[];
  const byProvider = new Map<string, PilotConnectionSummary>();

  for (const row of connections) {
    const key = row.provider?.provider_key;

    if (key && !byProvider.has(key)) {
      byProvider.set(key, row);
    }
  }

  const googleOutcome = google ? googleOutcomeMessages[google] : undefined;
  const base = `/partner/clients/${clientId}`;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Rocket className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-semibold">Pilot stack</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              The first real-world loop runs on one small stack: leads arrive
              through the{" "}
              <Link href={`${base}/setup`} className="underline">
                lead source you set up
              </Link>
              , the AI routes and drafts, HubSpot keeps the contact list
              current, Twilio sends the replies you approve, and Google
              Calendar covers scheduling. Every connection starts in dry run —
              nothing real is sent until you switch it to live. Follow{" "}
              <code className="rounded bg-secondary px-1 py-0.5 text-xs">
                docs/13-real-world-pilot-test-plan.md
              </code>{" "}
              for the full step-by-step test.
            </p>
          </div>
        </div>
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

      {(Object.keys(PILOT_PROVIDERS) as PilotProviderKey[]).map((key) => (
        <PilotProviderCard
          key={key}
          clientId={clientId}
          meta={PILOT_PROVIDERS[key]}
          connection={byProvider.get(key) ?? null}
          oauthRedirectUri={key === "google_calendar" ? googleRedirectUri() : undefined}
          canManage={access.canManageIntegrations}
        />
      ))}

      <section className="rounded-lg border bg-card p-6">
        <h3 className="font-semibold">What happens on a real lead</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            A lead arrives at this client&apos;s intake endpoint (web form,
            web chat, or webhook — see the{" "}
            <Link href={`${base}/setup`} className="underline">
              Setup tab
            </Link>
            ).
          </li>
          <li>
            The AI intake router classifies it and the Lead Response workflow
            drafts a reply. The draft waits in{" "}
            <Link href={`${base}/approvals`} className="underline">
              Approvals
            </Link>{" "}
            — nothing is sent yet.
          </li>
          <li>
            The contact is created or updated in HubSpot with an &quot;AI
            Assistant&quot; note (dry-run preview until HubSpot is live). This
            step is additive-only and marked safe.
          </li>
          <li>
            When someone approves the draft, Twilio sends the SMS — only if
            the Twilio connection is live; otherwise the send is recorded as a
            dry run.
          </li>
          <li>
            Every step lands in{" "}
            <Link href={`${base}/runs`} className="underline">
              Runs / Logs
            </Link>{" "}
            and the{" "}
            <Link href={`${base}/audit`} className="underline">
              Audit trail
            </Link>
            , so you can see exactly what happened and what would have
            happened.
          </li>
        </ol>
        <p className="mt-3 text-xs text-muted-foreground">
          Honest limits in this release: calendar booking is connect + verify
          + event-creation ready, but no workflow books appointments
          automatically yet, and email delivery is not wired — SMS only.
        </p>
      </section>
    </div>
  );
}
