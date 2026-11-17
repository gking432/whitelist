"use server";

import { redirect } from "next/navigation";
import { startPlatformImpersonation } from "@/app/impersonation/actions";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function openTestWorkspace(layer: "partner" | "client") {
  return openNamedTestWorkspace(
    layer,
    layer === "client" ? "/client" : "/partner",
  );
}

export async function openMobileTestWorkspace() {
  return openNamedTestWorkspace("client", "/client/mobile");
}

async function openNamedTestWorkspace(
  layer: "partner" | "client",
  destination: "/partner" | "/client" | "/client/mobile",
) {
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
    const { data: clients, error: clientError } = await admin
      .from("client_businesses")
      .select("id,slug")
      .eq("partner_id", partner.id)
      .in("slug", ["sample-golf-shop", "sample-home-services"])
      .eq("is_test_account", true)
      .limit(2);
    if (clientError) throw new Error("The test client could not be loaded.");
    const client =
      clients?.find((item) => item.slug === "sample-golf-shop") ?? clients?.[0];
    if (!client) redirect("/control?workspace=client#accounts");
    targetId = client.id;
  }
  await startPlatformImpersonation(
    {
      targetKind: layer,
      targetId,
      requestedMode: "sandbox_full",
      destination,
      returnPath: "/",
    },
    new FormData(),
  );
}
