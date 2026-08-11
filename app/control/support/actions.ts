"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  codeRequestReadyForValidation,
  supportReleaseCanComplete,
} from "@/lib/support/release-gates";

function field(formData: FormData, key: string, max = 4000) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function ownerContext(next = "/control/support") {
  const auth = await getAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(next)}`);
  await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("Support is unavailable.");
  return { user: auth.user, admin };
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
  const featureFlagKey = field(formData, "feature_flag_key", 160) || null;
  const stagingUrl = field(formData, "staging_url", 500) || null;
  const evidence = field(formData, "test_evidence", 3000);
  if (!branchName) return;
  const [{ data: ticket }, { data: codeRequest }] = await Promise.all([
    admin.from("support_tickets").select("partner_id, client_id").eq("id", ticketId).maybeSingle(),
    admin.from("integration_requests").select("id, status").eq("support_ticket_id", ticketId).maybeSingle(),
  ]);
  if (!ticket) return;
  if (!codeRequestReadyForValidation(codeRequest?.status)) return;
  await Promise.all([
    admin.from("support_ticket_releases").upsert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, branch_name: branchName, feature_flag_key: featureFlagKey, staging_url: stagingUrl, status: "requester_validation", test_evidence: { summary: evidence }, approved_by: user.id, approved_at: new Date().toISOString() }, { onConflict: "ticket_id" }),
    admin.from("support_tickets").update({ status: "validation", current_route: "partner" }).eq("id", ticketId),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: ticket.partner_id, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.validation_started", audience: "partner", summary: "A tested change is ready for requester validation." }),
  ]);
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
}

export async function markSupportReleaseComplete(formData: FormData) {
  const ticketId = field(formData, "ticket_id", 80);
  const resolution = field(formData, "resolution", 3000);
  const { user, admin } = await ownerContext(`/control/support/${ticketId}`);
  const [{ data: release }, { data: codeRequest }] = await Promise.all([
    admin.from("support_ticket_releases").select("id, partner_id, client_id, status").eq("ticket_id", ticketId).maybeSingle(),
    admin.from("integration_requests").select("id, status").eq("support_ticket_id", ticketId).maybeSingle(),
  ]);
  if (!release || !supportReleaseCanComplete({
    releaseStatus: release.status,
    codeRequestStatus: codeRequest?.status,
  })) return;
  const now = new Date().toISOString();
  const updates = [
    admin.from("support_ticket_releases").update({ status: "released", released_at: now }).eq("id", release.id),
    admin.from("support_tickets").update({ status: "resolved", current_route: "owner", resolved_by: user.id, resolved_at: now, resolution: resolution || "Requester validated the change and the owner marked the release complete." }).eq("id", ticketId),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: release.partner_id, client_id: release.client_id, actor_id: user.id, event_type: "ticket.release_completed", audience: "partner", summary: "Requester-approved release marked complete by the platform owner." }),
  ];
  if (codeRequest) {
    updates.push(
      admin.from("integration_requests").update({ status: "released", released_at: now }).eq("id", codeRequest.id),
      admin.from("connector_development_tasks").update({ status: "released", completed_at: now }).eq("request_id", codeRequest.id),
    );
  }
  await Promise.all(updates);
  revalidatePath(`/control/support/${ticketId}`);
  revalidatePath(`/partner/support/${ticketId}`);
}
