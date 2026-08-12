import type { SupabaseClient } from "@supabase/supabase-js";

import {
  runCodexConnectorTask,
  type CodexConnectorRun,
} from "./codex-worker.ts";

export const CONNECTOR_TASK_LEASE_MINUTES = 30;
export const CONNECTOR_TASK_HEARTBEAT_MS = 15_000;

export type ConnectorDevelopmentTask = {
  id: string;
  request_id: string;
  prompt_snapshot: string;
  branch_name: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  available_at: string;
};

type ConnectorTaskRun = (
  prompt: string,
  branchName: string,
) => Promise<CodexConnectorRun>;

export function connectorTaskRetryDelayMinutes(attemptCount: number): number {
  return Math.min(60, Math.max(1, 2 ** Math.max(0, attemptCount - 1)));
}

export function connectorTaskStaleBefore(
  now = new Date(),
  leaseMinutes = CONNECTOR_TASK_LEASE_MINUTES,
): string {
  return new Date(now.getTime() - leaseMinutes * 60_000).toISOString();
}

export async function recoverStaleConnectorTasks(
  admin: SupabaseClient,
  now = new Date(),
) {
  const staleBefore = connectorTaskStaleBefore(now);
  const { data: stale } = await admin
    .from("connector_development_tasks")
    .select("id, request_id, attempt_count, max_attempts")
    .eq("status", "running")
    .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleBefore}`);

  let requeued = 0;
  let failed = 0;
  for (const task of stale ?? []) {
    const exhausted = task.attempt_count >= task.max_attempts;
    const { data } = await admin
      .from("connector_development_tasks")
      .update({
        status: exhausted ? "failed" : "queued",
        worker_id: null,
        heartbeat_at: null,
        available_at: exhausted
          ? now.toISOString()
          : new Date(
              now.getTime() +
                connectorTaskRetryDelayMinutes(task.attempt_count) * 60_000,
            ).toISOString(),
        error_message: "The connector worker lease expired before completion.",
        completed_at: exhausted ? now.toISOString() : null,
      })
      .eq("id", task.id)
      .eq("status", "running")
      .or(`heartbeat_at.is.null,heartbeat_at.lt.${staleBefore}`)
      .select("id")
      .maybeSingle();
    if (!data) continue;
    if (exhausted) {
      failed += 1;
      await admin
        .from("integration_requests")
        .update({ status: "blocked" })
        .eq("id", task.request_id);
      const supportTicketId = await linkedSupportTicket(admin, task.request_id);
      if (supportTicketId) {
        await admin
          .from("support_tickets")
          .update({ status: "platform_working", current_route: "owner" })
          .eq("id", supportTicketId);
      }
    } else {
      requeued += 1;
    }
  }

  return { scanned: stale?.length ?? 0, requeued, failed };
}

export async function claimNextConnectorTask(
  admin: SupabaseClient,
  workerId: string,
  now = new Date(),
  taskId?: string,
): Promise<ConnectorDevelopmentTask | null> {
  let candidateQuery = admin
    .from("connector_development_tasks")
    .select(
      "id, request_id, prompt_snapshot, branch_name, status, attempt_count, max_attempts, available_at",
    )
    .eq("status", "queued")
    .lte("available_at", now.toISOString());
  if (taskId) candidateQuery = candidateQuery.eq("id", taskId);

  const { data: candidate } = await candidateQuery
    .order("available_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate || !candidate.branch_name) return null;

  const { data: claimed } = await admin
    .from("connector_development_tasks")
    .update({
      status: "running",
      worker_id: workerId,
      heartbeat_at: now.toISOString(),
      started_at: now.toISOString(),
      completed_at: null,
      error_message: null,
      attempt_count: candidate.attempt_count + 1,
    })
    .eq("id", candidate.id)
    .eq("status", "queued")
    .eq("attempt_count", candidate.attempt_count)
    .lte("available_at", now.toISOString())
    .select(
      "id, request_id, prompt_snapshot, branch_name, status, attempt_count, max_attempts, available_at",
    )
    .maybeSingle();

  return (claimed as ConnectorDevelopmentTask | null) ?? null;
}

async function linkedSupportTicket(admin: SupabaseClient, requestId: string) {
  const { data } = await admin
    .from("integration_requests")
    .select("support_ticket_id")
    .eq("id", requestId)
    .maybeSingle();
  return data?.support_ticket_id ?? null;
}

export async function executeClaimedConnectorTask(
  admin: SupabaseClient,
  task: ConnectorDevelopmentTask,
  workerId: string,
  runTask: ConnectorTaskRun = runCodexConnectorTask,
) {
  await admin
    .from("integration_requests")
    .update({ status: "building" })
    .eq("id", task.request_id);
  const supportTicketId = await linkedSupportTicket(admin, task.request_id);
  if (supportTicketId) {
    await admin
      .from("support_tickets")
      .update({ status: "platform_working", current_route: "codex" })
      .eq("id", supportTicketId);
  }

  const heartbeat = setInterval(() => {
    void admin
      .from("connector_development_tasks")
      .update({ heartbeat_at: new Date().toISOString() })
      .eq("id", task.id)
      .eq("status", "running")
      .eq("worker_id", workerId);
  }, CONNECTOR_TASK_HEARTBEAT_MS);

  try {
    const run = await runTask(task.prompt_snapshot, task.branch_name);
    const now = new Date().toISOString();
    const { data: completed } = await admin
      .from("connector_development_tasks")
      .update({
        status: "succeeded",
        codex_thread_id: run.threadId,
        final_response: `${run.finalResponse}\n\nWorktree: ${run.worktreePath}`,
        worker_id: null,
        heartbeat_at: null,
        completed_at: now,
      })
      .eq("id", task.id)
      .eq("status", "running")
      .eq("worker_id", workerId)
      .select("id")
      .maybeSingle();

    if (!completed) {
      throw new Error("The connector task lease was lost before completion.");
    }

    await admin
      .from("integration_requests")
      .update({ status: "testing" })
      .eq("id", task.request_id);
    if (supportTicketId) {
      await admin
        .from("support_tickets")
        .update({ status: "platform_working", current_route: "platform" })
        .eq("id", supportTicketId);
    }
    return { status: "succeeded" as const, taskId: task.id };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 2000) : "Codex task failed.";
    const exhausted = task.attempt_count >= task.max_attempts;
    const now = new Date();
    const { data: released } = await admin
      .from("connector_development_tasks")
      .update({
        status: exhausted ? "failed" : "queued",
        worker_id: null,
        heartbeat_at: null,
        available_at: exhausted
          ? now.toISOString()
          : new Date(
              now.getTime() +
                connectorTaskRetryDelayMinutes(task.attempt_count) * 60_000,
            ).toISOString(),
        error_message: detail,
        completed_at: exhausted ? now.toISOString() : null,
      })
      .eq("id", task.id)
      .eq("status", "running")
      .eq("worker_id", workerId)
      .select("id")
      .maybeSingle();
    if (!released) {
      return { status: "lease_lost" as const, taskId: task.id, error: detail };
    }
    await admin
      .from("integration_requests")
      .update({ status: exhausted ? "blocked" : "building" })
      .eq("id", task.request_id);
    if (supportTicketId && exhausted) {
      await admin
        .from("support_tickets")
        .update({ status: "platform_working", current_route: "owner" })
        .eq("id", supportTicketId);
    }
    return {
      status: exhausted ? ("failed" as const) : ("requeued" as const),
      taskId: task.id,
      error: detail,
    };
  } finally {
    clearInterval(heartbeat);
  }
}

export async function processNextConnectorTask(
  admin: SupabaseClient,
  workerId: string,
  runTask: ConnectorTaskRun = runCodexConnectorTask,
) {
  const task = await claimNextConnectorTask(admin, workerId);
  if (!task) return { status: "idle" as const };
  return executeClaimedConnectorTask(admin, task, workerId, runTask);
}
