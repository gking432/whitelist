"use server";

import { redirect } from "next/navigation";
import { startPlatformImpersonation } from "@/app/impersonation/actions";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function openTestWorkspace(layer: "partner" | "client") {
  const user = await requireAuthenticatedUser("/");
  await requirePlatformRole(user.id, ["platform_owner", "platform_admin"]);
  if (layer !== "partner" && layer !== "client")
    throw new Error("Unknown workspace.");
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");

  const { data: partner, error } = await admin
    .from("partners")
    .select("id")
    .eq("slug", "northstar-beta-agency")
    .eq("is_test_account", true)
    .maybeSingle();
  if (error) throw new Error("The test agency could not be loaded.");
  if (!partner) redirect(`/control?workspace=${layer}#accounts`);

  let targetId = partner.id;
  if (layer === "client") {
    const { data: client, error: clientError } = await admin
      .from("client_businesses")
      .select("id")
      .eq("partner_id", partner.id)
      .eq("slug", "sample-home-services")
      .eq("is_test_account", true)
      .maybeSingle();
    if (clientError) throw new Error("The test client could not be loaded.");
    if (!client) redirect("/control?workspace=client#accounts");
    targetId = client.id;
  }
  await startPlatformImpersonation(
    {
      targetKind: layer,
      targetId,
      requestedMode: "sandbox_full",
      returnPath: "/",
    },
    new FormData(),
  );
}
