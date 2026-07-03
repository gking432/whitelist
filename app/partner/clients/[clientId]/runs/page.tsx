import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Runs / Logs",
};

export const dynamic = "force-dynamic";

const RUN_STATUSES = [
  "succeeded",
  "failed",
  "paused_for_approval",
  "running",
  "skipped",
] as const;

type PageProps = {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ status?: string }>;
};

type RunRow = {
  id: string;
  status: string;
  runtime_mode: string;
  summary: string | null;
  requires_approval: boolean;
  error_message: string | null;
  created_at: string;
  instance: { name: string } | null;
  trigger_event: { event_type: string } | null;
};

export default async function ClientRunsPage({
  params,
  searchParams,
}: PageProps) {
  const { clientId } = await params;
  const { status } = await searchParams;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const statusFilter = RUN_STATUSES.includes(status as never) ? status : null;

  let query = supabase
    .from("workflow_runs")
    .select(
      "id, status, runtime_mode, summary, requires_approval, error_message, created_at, instance:client_workflow_instances(name), trigger_event:integration_events!workflow_runs_trigger_event_id_fkey(event_type)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Runs unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Workflow runs could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const runs = (data ?? []) as unknown as RunRow[];
  const base = `/partner/clients/${clientId}/runs`;

  const filters = [
    { label: "All", value: null },
    ...RUN_STATUSES.map((value) => ({ label: formatEnum(value), value })),
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">Runs / Logs</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Every workflow execution for this client, including failures and
          approval pauses.
        </p>
      </div>

      <nav aria-label="Run status filter" className="flex flex-wrap gap-2">
        {filters.map((filter) => {
          const isActive = filter.value === statusFilter;
          const href = filter.value ? `${base}?status=${filter.value}` : base;

          return (
            <Link
              key={filter.label}
              href={href}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-secondary",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      {runs.length === 0 ? (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <ClipboardList
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">
            {statusFilter ? "No runs match this filter" : "No runs yet"}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {statusFilter
              ? "Try a different status filter."
              : "Runs appear when inbound events trigger an enabled workflow."}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="border-b bg-secondary/40 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Time</th>
                  <th className="px-4 py-3 font-medium">Workflow</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Mode</th>
                  <th className="px-4 py-3 font-medium">Approval</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {runs.map((run) => (
                  <tr key={run.id} className="hover:bg-secondary/30">
                    <td className="px-5 py-3.5 text-muted-foreground">
                      <Link href={`${base}/${run.id}`} className="hover:underline">
                        {formatDateTime(run.created_at)}
                      </Link>
                    </td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`${base}/${run.id}`}
                        className="font-medium hover:underline"
                      >
                        {run.instance?.name ?? "Workflow"}
                      </Link>
                      {run.error_message ? (
                        <p className="mt-0.5 max-w-72 truncate text-xs text-destructive">
                          {run.error_message}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {run.trigger_event?.event_type ?? "—"}
                    </td>
                    <td className="px-4 py-3.5">
                      <Badge variant="outline">{formatEnum(run.status)}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {formatEnum(run.runtime_mode)}
                    </td>
                    <td className="px-4 py-3.5 text-muted-foreground">
                      {run.requires_approval ? "Required" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
