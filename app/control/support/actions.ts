"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  normalizeFeatureFlagKey,
  normalizeReleaseVersion,
} from "@/lib/support/release-lifecycle";
import {
  codeRequestReadyForValidation,
  supportReleaseCanComplete,
} from "@/lib/support/release-gates";
import { queueSupportNotification } from "@/lib/support/notifications";

function field(formData: FormData, key: string, max = 4000) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ownerContext(next = "/control/support") {
  const auth = await getAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  const access = await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Support is unavailable.");
  return { user: auth.user, access, admin };
}

export async function updatePlatformSupportTicket(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const status = field(formData, "status", 40);
  const route = field(formData, "route", 40);
  const body = field(formData, "body");
  const audience = field(formData, "audience", 20) === "partner" ? "partner" : "internal";
  const { data: ticket } = await admin.from("support_tickets").select("id, partner_id, client_id").eq("id", ticketId).maybeSingle();
  if (!ticket) return;

  await admin.from("support_tickets").update({ status, current_route: route, assigned_to: user.id }).eq("id", ticketId);
  if (body) {
    await admin.from("support_ticket_messages").insert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, author_id: user.id, author_kind: "platform", audience, body });
  }
  await admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.platform_updated", audience: audience === "partner" ? "partner" : "internal", summary: `Status changed to ${status.replaceAll("_", " ")} and routed to ${route.replaceAll("_", " ")}.` });
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath("/control/integrations");
  revalidatePath("/partner/integrations");
}

export async function createCodeWorkFromSupport(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const { data: ticket } = await admin.from("support_tickets").select("*").eq("id", ticketId).maybeSingle();
  if (!ticket) return;
  const { data: existing } = await admin.from("integration_requests").select("id").eq("support_ticket_id", ticketId).maybeSingle();
  let requestId = existing?.id;
  if (!requestId) {
    const { data: request, error } = await admin.from("integration_requests").insert({
      partner_id: ticket.partner_id,
      client_id: ticket.client_id,
      requested_by: user.id,
      application_name: ticket.affected_area || "Platform product",
      category: ticket.category === "integration_request" ? "integration" : "product",
      trigger_description: ticket.description,
      desired_result: ticket.title,
      current_systems: [],
      priority: ticket.priority === "critical" ? "blocking" : ticket.priority,
      status: "requested",
      support_ticket_id: ticketId,
    }).select("id").single();
    if (error || !request) return;
    requestId = request.id;
  }
  await Promise.all([
    admin.from("support_tickets").update({ status: "platform_working", current_route: "codex", assigned_to: user.id }).eq("id", ticketId),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.code_work_created", audience: "partner", summary: "Owner approved this request for guarded code preparation.", metadata: { integration_request_id: requestId } }),
  ]);
  redirect("/control/integrations");
}

export async function startRequesterValidation(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const branchName = field(formData, "branch_name", 200);
  const releaseVersion = normalizeReleaseVersion(
    field(formData, "release_version", 80),
  );
  const rawFeatureFlagKey = field(formData, "feature_flag_key", 160);
  const featureFlagKey = normalizeFeatureFlagKey(rawFeatureFlagKey);
  const stagingUrl = field(formData, "staging_url", 500) || null;
  const evidence = field(formData, "test_evidence", 3000);
  if (!branchName || !releaseVersion || (rawFeatureFlagKey && !featureFlagKey)) return;
  const [{ data: ticket }, { data: codeRequest }] = await Promise.all([
    admin.from("support_tickets").select("partner_id, client_id").eq("id", ticketId).maybeSingle(),
    admin.from("integration_requests").select("id, status").eq("support_ticket_id", ticketId).maybeSingle(),
  ]);
  if (!ticket) return;
  if (!codeRequestReadyForValidation(codeRequest?.status)) return;
  await Promise.all([
    admin.from("support_ticket_releases").upsert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, branch_name: branchName, feature_flag_key: featureFlagKey, release_version: releaseVersion, staging_url: stagingUrl, status: "requester_validation", test_evidence: { summary: evidence }, approved_by: user.id, approved_at: new Date().toISOString(), requester_confirmed_by: null, requester_confirmed_at: null, requester_notes: null, released_at: null, rolled_back_at: null, rolled_back_by: null, rollback_reason: null }, { onConflict: "ticket_id" }),
    admin.from("support_tickets").update({ status: "validation", current_route: "partner" }).eq("id", ticketId),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.validation_started", audience: "partner", summary: `Release ${releaseVersion} is ready for requester validation.`, metadata: { release_version: releaseVersion, branch_name: branchName } }),
  ]);
  if (codeRequest) {
    await Promise.all([
      admin.from("integration_requests").update({ release_version: releaseVersion, staging_evidence: { summary: evidence, branch_name: branchName, staging_url: stagingUrl } }).eq("id", codeRequest.id),
      admin.from("connector_development_tasks").update({ status: "staged" }).eq("request_id", codeRequest.id).eq("status", "succeeded"),
    ]);
  }
  await queueSupportNotification({ admin, ticketId, partnerId: ticket.partner_id, kind: "partner", eventKey: `validation:${releaseVersion}`, title: `Release ${releaseVersion} is ready to validate`, summary: evidence || "A tested change is ready for requester validation." });
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath("/control/integrations");
  revalidatePath("/partner/integrations");
}

export async function markSupportReleaseComplete(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const resolution = field(formData, "resolution", 3000);
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const [{ data: release }, { data: codeRequest }] = await Promise.all([
    admin.from("support_ticket_releases").select("id, partner_id, client_id, status, release_version").eq("ticket_id", ticketId).maybeSingle(),
    admin.from("integration_requests").select("id, status").eq("support_ticket_id", ticketId).maybeSingle(),
  ]);
  if (!release || !supportReleaseCanComplete({
    releaseStatus: release.status,
    codeRequestStatus: codeRequest?.status,
  })) return;
  const releaseVersion = normalizeReleaseVersion(release.release_version ?? "");
  if (!releaseVersion) return;
  const { data: completed, error } = await admin.rpc(
    "complete_connector_support_release",
    { p_ticket_id: ticketId, p_actor_id: user.id, p_release_version: releaseVersion, p_resolution: resolution },
  );
  if (error || !completed) return;
  await queueSupportNotification({ admin, ticketId, partnerId: release.partner_id, kind: "partner", eventKey: `released:${releaseVersion}`, title: `Release ${releaseVersion} completed`, summary: resolution || "The requester-approved release was recorded by the platform owner." });
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath(`/client/support/${ticketId}`);
  revalidatePath("/control/integrations");
  revalidatePath("/partner/integrations");
}

export async function rollbackSupportRelease(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const reason = field(formData, "reason", 3000);
  if (!ticketId || !reason) return;
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const { data: release } = await admin
    .from("support_ticket_releases")
    .select("partner_id, status, release_version")
    .eq("ticket_id", ticketId)
    .maybeSingle();
  if (!release || release.status !== "released") return;
  const { data: rolledBack, error } = await admin.rpc(
    "rollback_connector_support_release",
    { p_ticket_id: ticketId, p_actor_id: user.id, p_reason: reason },
  );
  if (error || !rolledBack) return;
  const releaseVersion = release.release_version || "unknown";
  await queueSupportNotification({ admin, ticketId, partnerId: release.partner_id, kind: "partner", eventKey: `rolled-back:${releaseVersion}`, title: `Release ${releaseVersion} rolled back`, summary: reason, urgent: true });
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath(`/client/support/${ticketId}`);
  revalidatePath("/control/integrations");
  revalidatePath("/partner/integrations");
}
