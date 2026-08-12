"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import {
  buildConnectorDevelopmentPrompt,
  connectorRevisionBranchName,
} from "@/lib/integrations/connector-development";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const STATUSES = ["requested", "researching", "needs_information", "building", "testing", "ready", "blocked", "declined"];

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
  if (["released", "rolled_back"].includes(request.status)) return;
  await supabase.from("integration_requests").update({ status }).eq("id", requestId);
  if (message) {
    await supabase.from("integration_request_messages").insert({ request_id: requestId, partner_id: request.partner_id, author_id: auth.user.id, audience: internal ? "internal" : "partner", body: message });
  }
  if (request.support_ticket_id && admin) {
    const mappedStatus = status === "needs_information"
      ? "waiting_requester"
      : status === "declined"
          ? "resolved"
          : "platform_working";
    const now = new Date().toISOString();
    await admin.from("support_tickets").update({
      status: mappedStatus,
      current_route: status === "ready" ? "owner" : "platform",
      resolved_by: mappedStatus === "resolved" ? auth.user.id : null,
      resolved_at: mappedStatus === "resolved" ? now : null,
      resolution: status === "declined" ? message || "The connector request was declined." : undefined,
    }).eq("id", request.support_ticket_id);
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
  const { data: existingTask } = await supabase
    .from("connector_development_tasks")
    .select("revision_number")
    .eq("request_id", requestId)
    .maybeSingle();
  const revisionNumber = Math.min(
    9999,
    Math.max(1, (existingTask?.revision_number ?? 0) + 1),
  );
  const branchName = connectorRevisionBranchName(spec, revisionNumber);
  await supabase.from("connector_development_tasks").upsert({
    request_id: requestId,
    created_by: auth.user.id,
    status: "awaiting_approval",
    prompt_snapshot: buildConnectorDevelopmentPrompt(spec, branchName),
    branch_name: branchName,
    revision_number: revisionNumber,
    error_message: null,
    worker_id: null,
    heartbeat_at: null,
    available_at: new Date().toISOString(),
    attempt_count: 0,
    started_at: null,
    completed_at: null,
    approved_by: null,
    approved_at: null,
    codex_thread_id: null,
    final_response: null,
  }, { onConflict: "request_id" });
  await supabase.from("integration_requests").update({ status: "building", released_at: null }).eq("id", requestId);
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
  await supabase.from("connector_development_tasks").update({ status: "queued", approved_by: auth.user.id, approved_at: new Date().toISOString(), available_at: new Date().toISOString(), error_message: null }).eq("id", taskId).eq("status", "awaiting_approval");
  revalidatePath("/control/integrations");
}
