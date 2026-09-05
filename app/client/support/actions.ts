"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth/session";
import { requirePrimaryClientAccess } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { queueSupportNotification } from "@/lib/support/notifications";
import { triageAndPersistSupportTicket } from "@/lib/support/service";

function field(formData: FormData, key: string, max = 2000) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function createClientSupportTicket(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) redirect("/login?next=/client/support");
  const access = await requirePrimaryClientAccess(auth.user.id);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin || !access.partnerId || !access.clientId) return;

  const title = field(formData, "title", 160);
  const description = field(formData, "description", 4000);
  const affectedArea = field(formData, "affected_area", 120) || null;
  if (!title || !description) return;

  const { data: ticket, error } = await supabase
    .from("support_tickets")
    .insert({
      partner_id: access.partnerId,
      client_id: access.clientId,
      requested_by: auth.user.id,
      origin: "client",
      title,
      description,
      affected_area: affectedArea,
      current_route: "partner",
    })
    .select("id")
    .single();
  if (error || !ticket) return;

  await Promise.all([
    admin.from("support_ticket_messages").insert({
      ticket_id: ticket.id,
      partner_id: access.partnerId,
      client_id: access.clientId,
      author_id: auth.user.id,
      author_kind: "client",
      audience: "client",
      body: description,
    }),
    admin.from("support_ticket_events").insert({
      ticket_id: ticket.id,
      partner_id: access.partnerId,
      client_id: access.clientId,
      actor_id: auth.user.id,
      event_type: "ticket.created",
      audience: "client",
      summary: "Support request submitted to your service provider.",
    }),
  ]);
  await triageAndPersistSupportTicket({
    supabase: admin,
    ticketId: ticket.id,
    partnerId: access.partnerId,
    clientId: access.clientId,
    origin: "client",
    title,
    description,
    affectedArea,
  });
  await queueSupportNotification({
    admin,
    ticketId: ticket.id,
    partnerId: access.partnerId,
    kind: "partner",
    title: `New client support request: ${title}`,
    summary: description,
  });
  redirect(`/client/support/${ticket.id}`);
}

export async function addClientSupportMessage(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) redirect("/login?next=/client/support");
  const access = await requirePrimaryClientAccess(auth.user.id);
  const supabase = await createSupabaseServerClient();
  if (!supabase || !access.partnerId || !access.clientId) return;
  const ticketId = field(formData, "ticket_id", 80);
  const body = field(formData, "body", 4000);
  if (!ticketId || !body) return;

  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id")
    .eq("id", ticketId)
    .eq("client_id", access.clientId)
    .maybeSingle();
  if (!ticket) return;
  await supabase.from("support_ticket_messages").insert({
    ticket_id: ticketId,
    partner_id: access.partnerId,
    client_id: access.clientId,
    author_id: auth.user.id,
    author_kind: "client",
    audience: "client",
    body,
  });
  revalidatePath(`/client/support/${ticketId}`);
}
