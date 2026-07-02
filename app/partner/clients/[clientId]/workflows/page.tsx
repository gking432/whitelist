import Link from "next/link";
import { Workflow } from "lucide-react";

import { EnableTemplateButton } from "@/components/partner/enable-template-button";
import { WorkflowStatusButtons } from "@/components/partner/workflow-status-buttons";
import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Workflows",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

type TemplateRow = {
  id: string;
  template_key: string;
  name: string;
  description: string | null;
  category: string;
  version: number;
  risk_level: string;
  requires_approval_default: boolean;
  trigger_events: string[];
  required_provider_categories: string[];
};

type InstanceRow = {
  id: string;
  template_id: string;
  name: string;
  status: string;
  runtime_mode: string;
  health_status: string;
  last_run_at: string | null;
  approval_policy: { requires_approval?: boolean };
};

export default async function ClientWorkflowsPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [templatesResult, instancesResult] = await Promise.all([
    supabase
      .from("workflow_templates")
      .select(
        "id, template_key, name, description, category, version, risk_level, requires_approval_default, trigger_events, required_provider_categories",
      )
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("client_workflow_instances")
      .select(
        "id, template_id, name, status, runtime_mode, health_status, last_run_at, approval_policy",
      )
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
  ]);

  if (templatesResult.error || instancesResult.error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Workflows unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Workflow data could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const templates = (templatesResult.data ?? []) as TemplateRow[];
  const instances = (instancesResult.data ?? []) as InstanceRow[];
  const enabledTemplateIds = new Set(
    instances.map((instance) => instance.template_id),
  );
  const availableTemplates = templates.filter(
    (template) => !enabledTemplateIds.has(template.id),
  );
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const base = `/partner/clients/${clientId}/workflows`;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Enabled workflows</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Automations configured for this client. Paused and disabled
            workflows never run.
          </p>
        </div>

        {instances.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
            <Workflow
              className="size-6 text-muted-foreground"
              aria-hidden="true"
            />
            <h3 className="mt-3 text-sm font-semibold">
              No workflows enabled yet
            </h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              Enable a workflow template below to start automating this
              client&apos;s operations.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {instances.map((instance) => {
              const template = templateById.get(instance.template_id);
              const requiresApproval =
                instance.approval_policy?.requires_approval ??
                template?.requires_approval_default ??
                false;

              return (
                <div
                  key={instance.id}
                  className="rounded-lg border bg-card p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`${base}/${instance.id}`}
                        className="font-semibold hover:underline"
                      >
                        {instance.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatEnum(template?.category ?? "")} · v
                        {template?.version ?? 1} · Triggers:{" "}
                        {(template?.trigger_events ?? []).join(", ") || "—"}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {formatEnum(instance.status)}
                    </Badge>
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Runtime mode
                      </dt>
                      <dd className="mt-0.5">
                        {formatEnum(instance.runtime_mode)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Approval
                      </dt>
                      <dd className="mt-0.5">
                        {requiresApproval ? "Required" : "Not required"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">
                        Last run
                      </dt>
                      <dd className="mt-0.5">
                        {formatDateTime(instance.last_run_at)}
                      </dd>
                    </div>
                  </dl>

                  {access.canManageWorkflows ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                      <WorkflowStatusButtons
                        clientId={clientId}
                        instanceId={instance.id}
                        status={instance.status}
                      />
                      <Link
                        href={`${base}/${instance.id}`}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        Configure
                      </Link>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-semibold">Available templates</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Reusable automation patterns published by the platform.
          </p>
        </div>

        {availableTemplates.length === 0 ? (
          <div className="rounded-lg border bg-card px-6 py-8 text-center text-sm text-muted-foreground">
            All available templates are enabled for this client.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {availableTemplates.map((template) => (
              <div key={template.id} className="rounded-lg border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold">{template.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatEnum(template.category)} · Risk:{" "}
                      {formatEnum(template.risk_level)} ·{" "}
                      {template.requires_approval_default
                        ? "Approval required by default"
                        : "No approval by default"}
                    </p>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {template.description}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Triggers: {template.trigger_events.join(", ") || "—"}
                </p>
                {access.canManageWorkflows ? (
                  <div className="mt-4 border-t pt-4">
                    <EnableTemplateButton
                      clientId={clientId}
                      templateId={template.id}
                    />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
