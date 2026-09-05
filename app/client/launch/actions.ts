"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryClientAccess } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordAuditEvent } from "@/lib/audit/audit";

export async function acceptSupervisedBeta(formData: FormData): Promise<void> {
  const user = await requireAuthenticatedUser("/client/launch");
  const access = await requirePrimaryClientAccess(user.id, ["client_owner"]);
  if (access.isImpersonating || !access.clientId || !access.partnerId)
    redirect("/client/launch?notice=owner");
  const notes = String(formData.get("provider_test_notes") ?? "").trim();
  const fallback = String(formData.get("fallback_contact") ?? "").trim();
  if (
    notes.length < 40 ||
    notes.length > 2000 ||
    fallback.length < 5 ||
    fallback.length > 320 ||
    ["accounts", "consent", "supervision"].some(
      (key) => formData.get(key) !== "on",
    )
  )
    redirect("/client/launch?notice=incomplete");
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/client/launch?notice=unavailable");
  const { data: client, error } = await admin
    .from("client_businesses")
    .select("package_id")
    .eq("id", access.clientId)
    .eq("partner_id", access.partnerId)
    .single();
  if (error || !client?.package_id) redirect("/client/launch?notice=package");
  const { error: saveError } = await admin
    .from("client_beta_acceptances")
    .upsert({
      client_id: access.clientId,
      partner_id: access.partnerId,
      package_id: client.package_id,
      accepted_by: user.id,
      provider_test_notes: notes,
      fallback_contact: fallback,
      terms_version: "beta-2026-09",
      accepted_at: new Date().toISOString(),
    });
  if (saveError) redirect("/client/launch?notice=unavailable");
  await recordAuditEvent({
    actor: access,
    action: "client.beta_accepted",
    targetType: "client_business",
    targetId: access.clientId,
    summary:
      "Business owner approved supervised beta scope and fallback contact.",
    metadata: { package_id: client.package_id, terms_version: "beta-2026-09" },
  });
  revalidatePath(`/partner/clients/${access.clientId}/launch`);
  revalidatePath("/client/launch");
  redirect("/client/launch?notice=saved");
}
