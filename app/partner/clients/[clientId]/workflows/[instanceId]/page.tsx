import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { WorkflowInstanceForm, type SettingsField } from "@/components/partner/workflow-instance-form";
import { WorkflowStatusButtons } from "@/components/partner/workflow-status-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Workflow Configuration",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string; instanceId: string }>;
};

export default async function WorkflowInstancePage({ params }: PageProps) {
  const { clientId, instanceId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [instanceResult, runsResult] = await Promise.all([
    supabase
      .from("client_workflow_instances")
      .select(
        "*, template:workflow_templates(template_key, name, description, category, version, risk_level, requires_approval_default, trigger_events, required_provider_categories, settings_schema)",
      )
      .eq("id", instanceId)
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("workflow_runs")
      .select("id, status, summary, created_at")
      .eq("workflow_instance_id", instanceId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const instance = instanceResult.data;

  if (instanceResult.error || !instance) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Workflow not found</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          This workflow does not exist or is not accessible.
        </p>
        <Button asChild variant="outline" className="mt-4">
          <Link href={`/partner/clients/${clientId}/workflows`}>
            <ArrowLeft aria-hidden="true" />
            Back to workflows
          </Link>
        </Button>
      </section>
    );
  }

  const template = instance.template as {
    template_key: string;
    name: string;
    description: string | null;
    category: string;
    version: number;
    risk_level: string;
    requires_approval_default: boolean;
    trigger_events: string[];
    required_provider_categories: string[];
    settings_schema: { fields?: SettingsField[] };
  } | null;

  const runs = (runsResult.data ?? []) as {
    id: string;
    status: string;
    summary: string | null;
    created_at: string;
  }[];

  return (
    <div className="space-y-5">
      <div>
        <Button asChild variant="ghost" className="px-0">
          <Link href={`/partner/clients/${clientId}/workflows`}>
            <ArrowLeft aria-hidden="true" />
            Workflows
          </Link>
        </Button>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{instance.name}</h2>
          <Badge variant="outline">{formatEnum(instance.status)}</Badge>
          <Badge variant="outline">{formatEnum(instance.runtime_mode)}</Badge>
          <Badge variant="outline">
            Risk: {formatEnum(template?.risk_level ?? "low")}
          </Badge>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {template?.description}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Template v{template?.version ?? 1} · Triggers:{" "}
          {(template?.trigger_events ?? []).join(", ") || "—"} · Requires:{" "}
          {(template?.required_provider_categories ?? [])
            .map((category) => formatEnum(category))
            .join(", ") || "no integrations"}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.8fr)]">
        <section className="rounded-lg border bg-card p-6">
          {access.canManageWorkflows ? (
            <WorkflowInstanceForm
              clientId={clientId}
              instanceId={instanceId}
              runtimeMode={instance.runtime_mode}
              approvalPolicy={
                (instance.approval_policy ?? {}) as {
                  requires_approval?: boolean;
                }
              }
              settings={(instance.settings ?? {}) as Record<string, unknown>}
              settingsFields={template?.settings_schema?.fields ?? []}
              templateRequiresApproval={
                template?.requires_approval_default ?? false
              }
            />
          ) : (
            <p className="text-sm leading-6 text-muted-foreground">
              Workflow configuration requires a partner owner, admin, or
              implementer role.
            </p>
          )}
        </section>

        <div className="space-y-5">
          {access.canManageWorkflows ? (
            <section className="rounded-lg border bg-card p-5">
              <h3 className="text-sm font-semibold">Workflow state</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Paused and disabled workflows never run.
              </p>
              <div className="mt-3">
                <WorkflowStatusButtons
                  clientId={clientId}
                  instanceId={instanceId}
                  status={instance.status}
                />
              </div>
            </section>
          ) : null}

          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <h3 className="text-sm font-semibold">Recent runs</h3>
            </div>
            {runs.length === 0 ? (
              <div className="px-5 py-8 text-center text-sm text-muted-foreground">
                No runs yet for this workflow.
              </div>
            ) : (
              <div className="divide-y">
                {runs.map((run) => (
                  <Link
                    key={run.id}
                    href={`/partner/clients/${clientId}/runs/${run.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-secondary/30"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {run.summary ?? "Workflow run"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(run.created_at)}
                      </p>
                    </div>
                    <Badge variant="outline">{formatEnum(run.status)}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
