"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triageAndPersistSupportTicket } from "@/lib/support/service";
import { getAuthState } from "@/lib/auth/session";

export type RequestIntegrationState = {
  status: "idle" | "success" | "error";
  message: string;
};

const EMPTY_STATE: RequestIntegrationState = { status: "idle", message: "" };

function value(formData: FormData, key: string, max: number): string {
  const raw = formData.get(key);
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

export async function requestIntegration(
  _previous: RequestIntegrationState = EMPTY_STATE,
  formData: FormData,
): Promise<RequestIntegrationState> {
  const auth = await getAuthState();
  if (!auth.user) return { status: "error", message: "Sign in to continue." };

  const access = await requirePrimaryPartnerAccess(auth.user.id, PARTNER_MANAGER_ROLES);
  const supabase = await createSupabaseServerClient();
  if (!supabase || !access.partnerId) {
    return { status: "error", message: "Integration requests are unavailable." };
  }

  const applicationName = value(formData, "application_name", 120);
  const triggerDescription = value(formData, "trigger_description", 1200);
  const desiredResult = value(formData, "desired_result", 1200);
  const clientId = value(formData, "client_id", 80) || null;
  if (!applicationName || !triggerDescription || !desiredResult) {
    return {
      status: "error",
      message: "Enter the application, what starts the workflow, and what should happen.",
    };
  }

  if (clientId) {
    const { data: client } = await supabase
      .from("client_businesses")
      .select("id")
      .eq("id", clientId)
      .eq("partner_id", access.partnerId)
      .eq("account_kind", "managed_client")
      .maybeSingle();
    if (!client) return { status: "error", message: "Choose a valid client." };
  }

  const systems = value(formData, "current_systems", 600)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const { data: created, error } = await supabase
    .from("integration_requests")
    .insert({
      partner_id: access.partnerId,
      client_id: clientId,
      requested_by: auth.user.id,
      application_name: applicationName,
      application_url: value(formData, "application_url", 320) || null,
      category: value(formData, "category", 40) || "other",
      trigger_description: triggerDescription,
      desired_result: desiredResult,
      current_systems: systems,
      priority: value(formData, "priority", 20) || "normal",
    })
    .select("id")
    .single();

  if (error || !created) {
    return { status: "error", message: "The request could not be created." };
  }

  const admin = createSupabaseAdminClient();
  if (admin) {
    const title = `Connect ${applicationName}`;
    const description = `Trigger: ${triggerDescription}\n\nDesired result: ${desiredResult}`;
    const { data: ticket } = await admin.from("support_tickets").insert({
      partner_id: access.partnerId,
      client_id: clientId,
      requested_by: auth.user.id,
      origin: "partner",
      category: "integration_request",
      title,
      description,
      affected_area: applicationName,
      current_route: "platform",
    }).select("id").single();
    if (ticket) {
      await Promise.all([
        admin.from("integration_requests").update({ support_ticket_id: ticket.id }).eq("id", created.id),
        admin.from("support_ticket_messages").insert({ ticket_id: ticket.id, partner_id: access.partnerId, client_id: clientId, author_id: auth.user.id, author_kind: "partner", audience: "partner", body: description }),
        admin.from("support_ticket_events").insert({ ticket_id: ticket.id, partner_id: access.partnerId, client_id: clientId, actor_id: auth.user.id, event_type: "ticket.integration_requested", audience: "partner", summary: `Connector requested for ${applicationName}.`, metadata: { integration_request_id: created.id } }),
      ]);
      await triageAndPersistSupportTicket({ supabase: admin, ticketId: ticket.id, partnerId: access.partnerId, clientId, origin: "partner", title, description, affectedArea: applicationName });
    }
  }

  await recordAuditEvent({
    actor: access,
    action: "integration.request_created",
    targetType: "integration_request",
    targetId: created.id,
    summary: `Requested a connector for ${applicationName}.`,
  });
  revalidatePath("/partner/integrations");
  revalidatePath("/control/integrations");
  revalidatePath("/partner/support");
  revalidatePath("/control/support");
  return { status: "success", message: "Integration request created." };
}
