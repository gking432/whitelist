"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { recordAuditEvent } from "@/lib/audit/audit";
import { requirePrimaryClientAccess } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { supportsImportedLeadAutomation } from "@/lib/integrations/connectors/catalog";

export async function setImportedLeadAutomation(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser("/client/integrations");
  const access = await requirePrimaryClientAccess(user.id, [
    "client_owner",
    "client_manager",
  ]);
  if (
    access.isImpersonating ||
    !access.clientId ||
    !access.partnerId ||
    !access.canOperateCustomerActions ||
    !access.visibleClientSections.includes("settings")
  ) {
    redirect("/client/integrations?notice=denied");
  }
  const connectionId = String(formData.get("connection_id") ?? "");
  const enabled = formData.get("enabled") === "true";
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/client/integrations?notice=unavailable");
  const { data: connection, error } = await admin
    .from("integration_connections")
    .select(
      "id,status,config,updated_at,provider:integration_providers(provider_key)",
    )
    .eq("id", connectionId)
    .eq("partner_id", access.partnerId)
    .eq("client_id", access.clientId)
    .maybeSingle();
  const provider = connection?.provider as unknown as {
    provider_key: string;
  } | null;
  if (
    error ||
    !connection ||
    connection.status !== "connected" ||
    !provider ||
    !supportsImportedLeadAutomation(provider.provider_key)
  ) {
    redirect("/client/integrations?notice=unavailable");
  }
  const config = { ...(connection.config ?? {}) };
  if (enabled) config.lead_automation_enabled_at ??= new Date().toISOString();
  else delete config.lead_automation_enabled_at;
  // Compare-and-swap preserves concurrent OAuth, sync and other source settings.
  const { data: saved, error: saveError } = await admin
    .from("integration_connections")
    .update({ config })
    .eq("id", connection.id)
    .eq("partner_id", access.partnerId)
    .eq("client_id", access.clientId)
    .eq("updated_at", connection.updated_at)
    .select("id")
    .maybeSingle();
  if (saveError || !saved) redirect("/client/integrations?notice=changed");
  await recordAuditEvent({
    actor: access,
    action: "integration.imported_lead_automation_changed",
    targetType: "integration_connection",
    targetId: connection.id,
    summary: enabled
      ? "Enabled automation for future imported leads."
      : "Stopped automation for future imported leads.",
    metadata: { enabled },
  });
  revalidatePath("/client/integrations");
  redirect("/client/integrations?notice=saved");
}

export async function setNativeLifecycleAutomation(
  formData: FormData,
): Promise<void> {
  const user = await requireAuthenticatedUser("/client/integrations");
  const access = await requirePrimaryClientAccess(user.id, [
    "client_owner",
    "client_manager",
  ]);
  if (
    access.isImpersonating ||
    !access.clientId ||
    !access.partnerId ||
    !access.canOperateCustomerActions ||
    !access.visibleClientSections.includes("settings")
  )
    redirect("/client/integrations?notice=denied");
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/client/integrations?notice=unavailable");
  const enabled = formData.get("enabled") === "true";
  const { data: client, error } = await admin
    .from("client_businesses")
    .select("id,native_lifecycle_enabled_at,crm_operating_mode,updated_at")
    .eq("id", access.clientId)
    .eq("partner_id", access.partnerId)
    .maybeSingle();
  if (
    error ||
    !client ||
    !["primary_crm", "mirror", "assist"].includes(client.crm_operating_mode)
  )
    redirect("/client/integrations?notice=unavailable");
  const { data: saved, error: saveError } = await admin
    .from("client_businesses")
    .update({
      native_lifecycle_enabled_at: enabled
        ? (client.native_lifecycle_enabled_at ?? new Date().toISOString())
        : null,
    })
    .eq("id", client.id)
    .eq("partner_id", access.partnerId)
    .eq("updated_at", client.updated_at)
    .select("id")
    .maybeSingle();
  if (saveError || !saved) redirect("/client/integrations?notice=changed");
  await recordAuditEvent({
    actor: access,
    action: "client.native_lifecycle_automation_changed",
    targetType: "client_business",
    targetId: client.id,
    summary: enabled
      ? "Enabled native CRM lifecycle automation for future activity."
      : "Stopped native CRM lifecycle automation.",
    metadata: { enabled },
  });
  revalidatePath("/client/integrations");
  redirect("/client/integrations?notice=saved");
}
