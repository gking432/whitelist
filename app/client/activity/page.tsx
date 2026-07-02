import { ClipboardList } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientPortal } from "@/lib/clients/portal";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ClientPortalActivityPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }

  const { access } = portal;
  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.clientId) {
    return null;
  }

  const { data, error } = await supabase
    .from("workflow_runs")
    .select(
      "id, status, summary, created_at, instance:client_workflow_instances(name)",
    )
    .eq("client_id", access.clientId)
    .order("created_at", { ascending: false })
    .limit(50);

  const runs = (data ?? []) as unknown as {
    id: string;
    status: string;
    summary: string | null;
    created_at: string;
    instance: { name: string } | null;
  }[];

  const restrictedView = !error && runs.length === 0 &&
    !["client_owner", "client_manager"].includes(access.role);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Recent automation runs for your business.
        </p>
      </header>

      {error ? (
        <section className="rounded-lg border bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Activity could not be loaded. Refresh to try again.
          </p>
        </section>
      ) : runs.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <ClipboardList
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="mt-3 text-sm font-semibold">No activity yet</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {restrictedView
              ? "Your role does not include activity history. Ask your business owner if you need access."
              : "Automation runs will appear here once your workflows start processing events."}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="divide-y">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {run.instance?.name ?? "Automation"}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {run.summary ?? "Run"} · {formatDateTime(run.created_at)}
                  </p>
                </div>
                <Badge variant="outline">{formatEnum(run.status)}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
