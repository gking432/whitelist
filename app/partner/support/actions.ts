"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { queueSupportNotification } from "@/lib/support/notifications";
import { triageAndPersistSupportTicket } from "@/lib/support/service";

function field(formData: FormData, key: string, max = 4000) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function partnerContext() {
  const auth = await getAuthState();
  if (!auth.user) redirect("/login?next=/partner/support");
  const access = await requirePrimaryPartnerAccess(auth.user.id, PARTNER_MANAGER_ROLES);
  const admin = createSupabaseAdminClient();
  if (!admin || !access.partnerId) throw new Error("Support is unavailable.");
  return { user: auth.user, access, admin };
}

export async function createPartnerSupportTicket(formData: FormData) {
  const { user, access, admin } = await partnerContext();
  const title = field(formData, "title", 160);
  const description = field(formData, "description");
  const affectedArea = field(formData, "affected_area", 120) || null;
  const clientId = field(formData, "client_id", 80) || null;
  if (!title || !description) return;

  if (clientId) {
    const { data: client } = await admin.from("client_businesses").select("id").eq("id", clientId).eq("partner_id", access.partnerId!).eq("account_kind", "managed_client").maybeSingle();
    if (!client) return;
  }

  const { data: ticket, error } = await admin.from("support_tickets").insert({
    partner_id: access.partnerId,
    client_id: clientId,
    requested_by: user.id,
    origin: "partner",
    title,
    description,
    affected_area: affectedArea,
    current_route: "support_ai",
  }).select("id").single();
  if (error || !ticket) return;

  await Promise.all([
    admin.from("support_ticket_messages").insert({ ticket_id: ticket.id, partner_id: access.partnerId, client_id: clientId, author_id: user.id, author_kind: "partner", audience: "partner", body: description }),
    admin.from("support_ticket_events").insert({ ticket_id: ticket.id, partner_id: access.partnerId, client_id: clientId, actor_id: user.id, event_type: "ticket.created", audience: "partner", summary: "Partner support request created." }),
  ]);
  const triage = await triageAndPersistSupportTicket({ supabase: admin, ticketId: ticket.id, partnerId: access.partnerId!, clientId, origin: "partner", title, description, affectedArea });
  if (triage.triage.priority === "critical" || triage.triage.recommendedRoute === "owner") {
    await queueSupportNotification({ admin, ticketId: ticket.id, partnerId: access.partnerId!, kind: "platform", title: `Partner support request: ${title}`, summary: description, urgent: triage.triage.priority === "critical" });
  }
  redirect(`/partner/support/${ticket.id}`);
}

export async function addPartnerSupportMessage(formData: FormData) {
  const { user, access, admin } = await partnerContext();
  const ticketId = field(formData, "ticket_id", 80);
  const body = field(formData, "body");
  const requestedAudience = field(formData, "audience", 20);
  if (!ticketId || !body) return;
  const { data: ticket } = await admin.from("support_tickets").select("id, client_id, status").eq("id", ticketId).eq("partner_id", access.partnerId!).maybeSingle();
  if (!ticket) return;
  const audience = requestedAudience === "client" && ticket.client_id ? "client" : "partner";
  await admin.from("support_ticket_messages").insert({ ticket_id: ticketId, partner_id: access.partnerId, client_id: ticket.client_id, author_id: user.id, author_kind: "partner", audience, body });
  if (ticket.status === "waiting_requester") await admin.from("support_tickets").update({ status: "partner_working" }).eq("id", ticketId);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath(`/client/support/${ticketId}`);
}

export async function escalatePartnerSupportTicket(formData: FormData) {
  const { user, access, admin } = await partnerContext();
  const ticketId = field(formData, "ticket_id", 80);
  const reason = field(formData, "reason", 2000);
  if (!ticketId || !reason) return;
  const { data: ticket } = await admin.from("support_tickets").select("id, client_id, category, priority").eq("id", ticketId).eq("partner_id", access.partnerId!).maybeSingle();
  if (!ticket) return;
  const ownerOnly = ticket.priority === "critical" || ["billing", "security", "permissions"].includes(ticket.category);
  await Promise.all([
    admin.from("support_tickets").update({ status: "escalated", current_route: ownerOnly ? "owner" : "platform", escalated_by: user.id, escalated_at: new Date().toISOString(), escalation_reason: reason }).eq("id", ticketId),
    admin.from("support_ticket_messages").insert({ ticket_id: ticketId, partner_id: access.partnerId, client_id: ticket.client_id, author_id: user.id, author_kind: "partner", audience: "internal", body: reason }),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: access.partnerId, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.escalated", audience: "partner", summary: "Escalated to platform support." }),
  ]);
  await queueSupportNotification({ admin, ticketId, partnerId: access.partnerId!, kind: "platform", title: `Escalated partner request: ${ticketId.slice(0, 8).toUpperCase()}`, summary: reason, urgent: ownerOnly });
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath("/control/support");
}

export async function resolvePartnerSupportTicket(formData: FormData) {
  const { user, access, admin } = await partnerContext();
  const ticketId = field(formData, "ticket_id", 80);
  const resolution = field(formData, "resolution", 3000);
  if (!ticketId || !resolution) return;
  const { data: ticket } = await admin.from("support_tickets").select("id, client_id").eq("id", ticketId).eq("partner_id", access.partnerId!).maybeSingle();
  if (!ticket) return;
  await Promise.all([
    admin.from("support_tickets").update({ status: "resolved", current_route: "partner", resolved_by: user.id, resolved_at: new Date().toISOString(), resolution }).eq("id", ticketId),
    admin.from("support_ticket_messages").insert({ ticket_id: ticketId, partner_id: access.partnerId, client_id: ticket.client_id, author_id: user.id, author_kind: "partner", audience: ticket.client_id ? "client" : "partner", body: `Resolved: ${resolution}` }),
    admin.from("support_ticket_events").insert({ ticket_id: ticketId, partner_id: access.partnerId, client_id: ticket.client_id, actor_id: user.id, event_type: "ticket.resolved", audience: ticket.client_id ? "client" : "partner", summary: "Support request resolved." }),
  ]);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath(`/client/support/${ticketId}`);
}

export async function confirmRequesterValidation(formData: FormData) {
  const { user, access, admin } = await partnerContext();
  const ticketId = field(formData, "ticket_id", 80);
  const notes = field(formData, "notes", 2000);
  const { data: release } = await admin.from("support_ticket_releases").select("id").eq("ticket_id", ticketId).eq("partner_id", access.partnerId!).eq("status", "requester_validation").maybeSingle();
  if (!release) return;
  await Promise.all([
    admin.from("support_ticket_releases").update({ status: "requester_approved", requester_confirmed_by: user.id, requester_confirmed_at: new Date().toISOString(), requester_notes: notes || null }).eq("id", release.id),
    admin.from("support_tickets").update({ status: "validation" }).eq("id", ticketId),
  ]);
  revalidatePath(`/partner/support/${ticketId}`);
  revalidatePath(`/control/support/${ticketId}`);
}
