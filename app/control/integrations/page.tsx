import Link from "next/link";
import { Wrench } from "lucide-react";

import {
  approveConnectorTask,
  prepareConnectorTask,
  updateIntegrationRequest,
} from "@/app/control/integrations/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { loadPlatformHealth } from "@/lib/ops/platform-health";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = { title: "Integration Requests" };
export const dynamic = "force-dynamic";

const statuses = [
  "requested",
  "researching",
  "needs_information",
  "building",
  "testing",
  "ready",
  "blocked",
  "declined",
];

export default async function IntegrationRequestQueuePage() {
  const user = await requireAuthenticatedUser("/control/integrations");
  await requirePlatformRole(user.id);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const health = await loadPlatformHealth(createSupabaseAdminClient());
  const workerReady = health.services.connector_worker.status === "ready";
  const { data: requests, error: requestsError } = await supabase
    .from("integration_requests")
    .select(
      "*, partner:partners!integration_requests_partner_id_fkey(name), client:client_businesses!integration_requests_client_id_fkey(name), task:connector_development_tasks(id, status, branch_name, error_message)",
    )
    .order("updated_at", { ascending: false });
  if (requestsError)
    throw new Error(
      `Could not load integration requests: ${requestsError.message}`,
    );

  return (
    <div className="min-w-0">
      <div className="space-y-5">
        <div>
          <div className="flex items-center gap-2">
            <Wrench className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Integration requests</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Research, build, test, and release reusable connectors requested by
            partners.
          </p>
        </div>
        {(requests ?? []).length === 0 ? (
          <section className="rounded-lg border bg-card p-8 text-sm text-muted-foreground">
            No requests are waiting.
          </section>
        ) : (
          (requests ?? []).map((request) => {
            const partner = request.partner as unknown as {
              name?: string;
            } | null;
            const client = request.client as unknown as {
              name?: string;
            } | null;
            const task = Array.isArray(request.task)
              ? request.task[0]
              : request.task;
            const canPrepare =
              !task ||
              ["failed", "rolled_back", "cancelled"].includes(task.status);
            const canEditStatus = !["released", "rolled_back"].includes(
              request.status,
            );
            return (
              <section
                key={request.id}
                className="rounded-lg border bg-card p-5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">
                        {request.application_name}
                      </h2>
                      <Badge variant="outline">{request.priority}</Badge>
                      <Badge variant="outline">
                        {request.status.replaceAll("_", " ")}
                      </Badge>
                      {request.release_version ? (
                        <Badge variant="outline">
                          v{request.release_version}
                        </Badge>
                      ) : null}
                      {task ? (
                        <Badge variant="outline">
                          Codex: {task.status.replaceAll("_", " ")}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {partner?.name ?? "Partner"} ·{" "}
                      {client?.name ?? "Agency-wide"}
                      {task?.branch_name ? ` · ${task.branch_name}` : ""}
                    </p>
                    {task?.error_message ? (
                      <p className="mt-2 text-xs text-destructive">
                        {task.error_message}
                      </p>
                    ) : null}
                  </div>
                  {request.application_url ? (
                    <a
                      className="text-sm font-medium text-primary hover:underline"
                      href={request.application_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Application website
                    </a>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-4 border-y py-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Trigger
                    </p>
                    <p className="mt-1 text-sm leading-6">
                      {request.trigger_description}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Desired result
                    </p>
                    <p className="mt-1 text-sm leading-6">
                      {request.desired_result}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {canPrepare ? (
                    <form action={prepareConnectorTask}>
                      <input
                        type="hidden"
                        name="request_id"
                        value={request.id}
                      />
                      <Button type="submit" variant="outline" size="sm">
                        {task ? "Prepare revision" : "Prepare Codex task"}
                      </Button>
                    </form>
                  ) : null}
                  {task?.status === "awaiting_approval" ? (
                    <form action={approveConnectorTask}>
                      <input type="hidden" name="task_id" value={task.id} />
                      <Button type="submit" variant="outline" size="sm">
                        Approve build
                      </Button>
                    </form>
                  ) : null}
                  {task?.status === "queued" ? (
                    <Badge
                      variant="outline"
                      className={
                        workerReady
                          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                          : "border-amber-200 bg-amber-50 text-amber-900"
                      }
                    >
                      {workerReady
                        ? "Queued · worker online"
                        : "Queued · worker offline"}
                    </Badge>
                  ) : null}
                </div>
                {canEditStatus ? (
                  <form
                    key={`${request.id}-${request.status}`}
                    action={updateIntegrationRequest}
                    className="mt-4 grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:items-end"
                  >
                    <input type="hidden" name="request_id" value={request.id} />
                    <label className="space-y-1.5 text-sm font-medium">
                      Status
                      <select
                        name="status"
                        defaultValue={request.status}
                        className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                      >
                        {statuses.map((status) => (
                          <option key={status} value={status}>
                            {status.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1.5 text-sm font-medium">
                      Update
                      <textarea
                        name="message"
                        className="min-h-9 w-full rounded-md border bg-background px-3 py-2 text-sm"
                        placeholder="Question, progress update, or internal note"
                      />
                    </label>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <input type="checkbox" name="internal" />
                        Internal only
                      </label>
                      <Button type="submit" size="sm" className="w-full">
                        Save update
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Release state is controlled from the linked support request.
                  </p>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
