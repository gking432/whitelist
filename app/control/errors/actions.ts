"use server";

import { revalidatePath } from "next/cache";

import { getAuthState } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function resolvePlatformError(formData: FormData) {
  const auth = await getAuthState();
  if (!auth.user) return;
  await requirePlatformRole(auth.user.id, ["platform_owner", "platform_admin"]);

  const id = String(formData.get("error_id") ?? "");
  const note = String(formData.get("resolution_note") ?? "").trim().slice(0, 1000);
  if (!id) return;

  const admin = createSupabaseAdminClient();
  if (!admin) return;
  await admin
    .from("platform_error_events")
    .update({
      resolved_at: new Date().toISOString(),
      resolved_by: auth.user.id,
      resolution_note: note || "Reviewed and resolved by the platform owner.",
    })
    .eq("id", id);
  revalidatePath("/control/errors");
  revalidatePath("/control");
}
