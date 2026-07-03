import Link from "next/link";
import { ArrowLeft, CircleCheck, CircleDot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Run Detail",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string; runId: string }>;
};

type RunDetail = {
  id: string;
  status: string;
  runtime_mode: string;
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: {
    steps?: { name: string; detail: string }[];
    output?: Record<string, unknown>;
    note?: string;
    ai?: {
      status: "ai" | "fallback";
      reason?: string;
      provider?: string;
      model?: string;
      latency_ms?: number;
      error?: string;
    } | null;
    context_snapshot?: Record<string, unknown>;
  } | null;
  error_code: string | null;
  error_message: string | null;
  requires_approval: boolean;
  created_at: string;
  instance: { id: string; name: string } | null;
  template: { name: string; template_key: string; risk_level: string } | null;
  trigger_event: {
    id: string;
    event_type: string;
    created_at: string;
    connection_id: string | null;
  } | null;
};

function SnapshotBlock({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  if (value === null || value === undefined) {
    return null;
  }

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground">{title}</h4>
      <pre className="mt-1.5 max-h-72 overflow-auto rounded-md bg-secondary/50 px-3 py-2 font-mono text-xs leading-5">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default async function RunDetailPage({ params }: PageProps) {
  const { clientId, runId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [runResult, approvalResult] = await Promise.all([
    supabase
      .from("workflow_runs")
      .select(
        "*, instance:client_workflow_instances(id, name), template:workflow_templates(name, template_key, risk_level), trigger_event:integration_events!workflow_runs_trigger_event_id_fkey(id, event_type, created_at, connection_id)",
      )
      .eq("id", runId)
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("approval_items")
      .select("id, title, status, risk_level, created_at")
      .eq("workflow_run_id", runId)
      .maybeSingle(),
  ]);

  const run = runResult.data as RunDetail | null;

  if (runResult.error || !run) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Run not found</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This workflow run does not exist or is not accessible.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/partner/clients/${clientId}/runs`}>
            <ArrowLeft aria-hidden="true" />
            Back to runs
          </Link>
        </Button>
      </section>
    );
  }

  const approval = approvalResult.data;
  const steps = run.output_snapshot?.steps ?? [];
  const isFailed = run.status === "failed";

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" className="px-0">
          <Link href={`/partner/clients/${clientId}/runs`}>
            <ArrowLeft aria-hidden="true" />
            Runs / Logs
          </Link>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">
            {run.instance?.name ?? run.template?.name ?? "Workflow run"}
          </h2>
          <Badge variant="outline">{formatEnum(run.status)}</Badge>
          <Badge variant="outline">{formatEnum(run.runtime_mode)}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {run.summary ?? "No summary recorded."}
        </p>
      </div>

      {isFailed ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-5">
          <h3 className="text-sm font-semibold text-red-900">Run failed</h3>
          <p className="mt-1 text-sm leading-6 text-red-900/90">
            {run.error_message ?? "No failure detail recorded."}
          </p>
          <p className="mt-2 text-xs text-red-900/70">
            Error code: {run.error_code ?? "unknown"} · Next step: check the
            workflow configuration and the trigger payload below, then have the
            external system resend the event.
          </p>
        </section>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <div className="space-y-5">
          <section className="rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Timeline</h3>
            {steps.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No step detail was recorded for this run.
              </p>
            ) : (
              <ol className="mt-4 space-y-4">
                {steps.map((step, index) => (
                  <li key={`${step.name}-${index}`} className="flex gap-3">
                    {index === steps.length - 1 && isFailed ? (
                      <CircleDot
                        className="mt-0.5 size-4 shrink-0 text-red-600"
                        aria-hidden="true"
                      />
                    ) : (
                      <CircleCheck
                        className="mt-0.5 size-4 shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium">{step.name}</p>
                      <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                        {step.detail}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {run.output_snapshot?.note ? (
              <p className="mt-4 rounded-md border bg-secondary/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {run.output_snapshot.note}
              </p>
            ) : null}
          </section>

          {run.output_snapshot?.ai ? (
            <section className="rounded-lg border bg-card p-5">
              <h3 className="text-sm font-semibold">AI execution</h3>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {run.output_snapshot.ai.status === "ai" ? (
                  <>
                    <Badge
                      variant="outline"
                      className="border-emerald-200 bg-emerald-50 text-emerald-800"
                    >
                      AI-generated
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {run.output_snapshot.ai.provider}/
                      {run.output_snapshot.ai.model}
                      {run.output_snapshot.ai.latency_ms
                        ? ` · ${run.output_snapshot.ai.latency_ms}ms`
                        : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge
                      variant="outline"
                      className="border-amber-200 bg-amber-50 text-amber-900"
                    >
                      Rule-based fallback
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {run.output_snapshot.ai.reason === "not_configured"
                        ? "AI provider is not configured for this environment."
                        : `The AI call failed: ${run.output_snapshot.ai.error ?? "unknown error"}`}
                    </span>
                  </>
                )}
              </div>
            </section>
          ) : null}

          <section className="space-y-4 rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Snapshots</h3>
            <SnapshotBlock title="Input (redacted)" value={run.input_snapshot} />
            <SnapshotBlock
              title="Prompt context (redacted)"
              value={run.output_snapshot?.context_snapshot}
            />
            <SnapshotBlock
              title="Structured output"
              value={run.output_snapshot?.output}
            />
          </section>
        </div>

        <div className="space-y-5">
          <section className="rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Run details</h3>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Started</dt>
                <dd className="mt-0.5">{formatDateTime(run.started_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Finished</dt>
                <dd className="mt-0.5">{formatDateTime(run.finished_at)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Template</dt>
                <dd className="mt-0.5">
                  {run.template?.name ?? "—"} (
                  {formatEnum(run.template?.risk_level ?? "low")} risk)
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Trigger</h3>
            {run.trigger_event ? (
              <dl className="mt-3 space-y-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Event type</dt>
                  <dd className="mt-0.5 font-mono text-xs">
                    {run.trigger_event.event_type}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Received</dt>
                  <dd className="mt-0.5">
                    {formatDateTime(run.trigger_event.created_at)}
                  </dd>
                </div>
                {run.trigger_event.connection_id ? (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Connection
                    </dt>
                    <dd className="mt-0.5">
                      <Link
                        href={`/partner/clients/${clientId}/integrations/${run.trigger_event.connection_id}`}
                        className="text-primary hover:underline"
                      >
                        View connection
                      </Link>
                    </dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                This run was not triggered by an integration event.
              </p>
            )}
          </section>

          <section className="rounded-lg border bg-card p-5">
            <h3 className="text-sm font-semibold">Approval</h3>
            {approval ? (
              <div className="mt-3">
                <p className="text-sm font-medium">{approval.title}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline">{formatEnum(approval.status)}</Badge>
                  <span className="text-xs text-muted-foreground">
                    Risk: {formatEnum(approval.risk_level)}
                  </span>
                </div>
                <Link
                  href={`/partner/clients/${clientId}/approvals`}
                  className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
                >
                  Open approval queue
                </Link>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {run.requires_approval
                  ? "The linked approval item could not be found."
                  : "This run did not require approval."}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
