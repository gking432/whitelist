"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import {
  buildConnectorDevelopmentPrompt,
  connectorBranchName,
} from "@/lib/integrations/connector-development";
import {
  codexConnectorWorkerReady,
  runCodexConnectorTask,
} from "@/lib/integrations/codex-worker";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supportReleaseCanComplete } from "@/lib/support/release-gates";

const STATUSES = ["requested", "researching", "needs_information", "building", "testing", "ready", "released", "blocked", "declined"];

export async function updateIntegrationRequest(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) return;
  const access = await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;
  const requestId = String(formData.get("request_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 2000);
  const internal = formData.get("internal") === "on";
  if (!requestId || !STATUSES.includes(status)) return;

  const admin = createSupabaseAdminClient();
  const { data: request } = await supabase.from("integration_requests").select("partner_id, client_id, status, application_name, support_ticket_id").eq("id", requestId).maybeSingle();
  if (!request) return;
  if (status === "released" && request.support_ticket_id && admin) {
    const { data: release } = await admin.from("support_ticket_releases").select("status").eq("ticket_id", request.support_ticket_id).maybeSingle();
    if (!supportReleaseCanComplete({
      releaseStatus: release?.status,
      codeRequestStatus: request.status,
    })) return;
  }
  await supabase.from("integration_requests").update({ status, released_at: status === "released" ? new Date().toISOString() : null }).eq("id", requestId);
  if (message) {
    await supabase.from("integration_request_messages").insert({ request_id: requestId, partner_id: request.partner_id, author_id: auth.user.id, audience: internal ? "internal" : "partner", body: message });
  }
  if (request.support_ticket_id && admin) {
    const mappedStatus = status === "needs_information"
      ? "waiting_requester"
      : status === "released" || status === "declined"
          ? "resolved"
          : "platform_working";
    const now = new Date().toISOString();
    await admin.from("support_tickets").update({
      status: mappedStatus,
      current_route: status === "ready" || status === "released" ? "owner" : "platform",
      resolved_by: mappedStatus === "resolved" ? auth.user.id : null,
      resolved_at: mappedStatus === "resolved" ? now : null,
      resolution: status === "declined" ? message || "The connector request was declined." : undefined,
    }).eq("id", request.support_ticket_id);
    if (status === "released") {
      await Promise.all([
        admin.from("support_ticket_releases").update({ status: "released", released_at: now }).eq("ticket_id", request.support_ticket_id),
        admin.from("connector_development_tasks").update({ status: "released", completed_at: now }).eq("request_id", requestId),
      ]);
    }
    if (message) {
      await admin.from("support_ticket_messages").insert({ ticket_id: request.support_ticket_id, partner_id: request.partner_id, client_id: request.client_id, author_id: auth.user.id, author_kind: "platform", audience: internal ? "internal" : "partner", body: message });
    }
  }
  await recordAuditEvent({ actor: access, action: "integration.request_status_updated", targetType: "integration_request", targetId: requestId, summary: `Moved ${request.application_name} from ${request.status} to ${status}.` });
  revalidatePath("/control/integrations");
  revalidatePath("/partner/integrations");
  if (request.support_ticket_id) {
    revalidatePath(`/control/support/${request.support_ticket_id}`);
    revalidatePath(`/partner/support/${request.support_ticket_id}`);
  }
}

export async function prepareConnectorTask(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) return;
  await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase) return;
  const requestId = String(formData.get("request_id") ?? "");
  const { data: request } = await supabase.from("integration_requests").select("id, application_name, application_url, category, trigger_description, desired_result, current_systems").eq("id", requestId).maybeSingle();
  if (!request) return;
  const spec = {
    id: request.id,
    applicationName: request.application_name,
    applicationUrl: request.application_url,
    category: request.category,
    triggerDescription: request.trigger_description,
    desiredResult: request.desired_result,
    currentSystems: request.current_systems ?? [],
  };
  await supabase.from("connector_development_tasks").upsert({
    request_id: requestId,
    created_by: auth.user.id,
    status: "awaiting_approval",
    prompt_snapshot: buildConnectorDevelopmentPrompt(spec),
    branch_name: connectorBranchName(spec),
    error_message: null,
  }, { onConflict: "request_id" });
  if (admin) {
    const { data: linked } = await admin.from("integration_requests").select("support_ticket_id").eq("id", requestId).maybeSingle();
    if (linked?.support_ticket_id) await admin.from("support_tickets").update({ status: "platform_working", current_route: "codex" }).eq("id", linked.support_ticket_id);
  }
  revalidatePath("/control/integrations");
}

export async function approveConnectorTask(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) return;
  await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return;
  const taskId = String(formData.get("task_id") ?? "");
  await supabase.from("connector_development_tasks").update({ status: "queued", approved_by: auth.user.id, approved_at: new Date().toISOString() }).eq("id", taskId).eq("status", "awaiting_approval");
  revalidatePath("/control/integrations");
}

export async function runConnectorTask(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) return;
  await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase) return;
  if (!codexConnectorWorkerReady()) return;
  const taskId = String(formData.get("task_id") ?? "");
  const { data: task } = await supabase.from("connector_development_tasks").select("id, request_id, prompt_snapshot, branch_name, status").eq("id", taskId).maybeSingle();
  if (!task || task.status !== "queued") return;
  await supabase.from("connector_development_tasks").update({ status: "running", started_at: new Date().toISOString(), error_message: null }).eq("id", taskId);
  await supabase.from("integration_requests").update({ status: "building" }).eq("id", task.request_id);
  const { data: linked } = admin ? await admin.from("integration_requests").select("support_ticket_id").eq("id", task.request_id).maybeSingle() : { data: null };
  if (linked?.support_ticket_id && admin) await admin.from("support_tickets").update({ status: "platform_working", current_route: "codex" }).eq("id", linked.support_ticket_id);
  try {
    const result = await runCodexConnectorTask(task.prompt_snapshot, task.branch_name);
    await supabase.from("connector_development_tasks").update({ status: "succeeded", codex_thread_id: result.threadId, final_response: `${result.finalResponse}\n\nWorktree: ${result.worktreePath}`, completed_at: new Date().toISOString() }).eq("id", taskId);
    await supabase.from("integration_requests").update({ status: "testing" }).eq("id", task.request_id);
    if (linked?.support_ticket_id && admin) await admin.from("support_tickets").update({ status: "platform_working", current_route: "platform" }).eq("id", linked.support_ticket_id);
  } catch (error) {
    await supabase.from("connector_development_tasks").update({ status: "failed", error_message: error instanceof Error ? error.message : "Codex task failed.", completed_at: new Date().toISOString() }).eq("id", taskId);
    await supabase.from("integration_requests").update({ status: "blocked" }).eq("id", task.request_id);
    if (linked?.support_ticket_id && admin) await admin.from("support_tickets").update({ status: "platform_working", current_route: "owner" }).eq("id", linked.support_ticket_id);
  }
  revalidatePath("/control/integrations");
}
