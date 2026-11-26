import type { SupabaseClient } from "@supabase/supabase-js";
import { getAppUrl } from "../env";
import { connectionSetupPath, decryptConnectionSetupToken, encryptConnectionSetupToken, generateConnectionSetupToken, hashConnectionSetupToken } from "../integrations/connection-setup";

/** Reuse the existing expiring credential flow, restricted to this provider. */
export async function prepareStripeSetup(admin: SupabaseClient, scope: { partnerId: string; clientId: string }, actorId: string) {
  const active = await admin.from("client_connection_setup_sessions")
    .select("encrypted_token,allowed_provider_keys")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("created_by", actorId)
    .eq("status", "active").gt("expires_at", new Date().toISOString())
    .contains("allowed_provider_keys", ["stripe"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (active.error) throw new Error("Secure Stripe setup could not be loaded.");
  let token: string;
  if (active.data?.allowed_provider_keys?.length === 1) token = decryptConnectionSetupToken(active.data.encrypted_token);
  else {
    token = generateConnectionSetupToken();
    const { data, error } = await admin.from("client_connection_setup_sessions").insert({
      partner_id: scope.partnerId, client_id: scope.clientId, created_by: actorId,
      token_hash: hashConnectionSetupToken(token), encrypted_token: encryptConnectionSetupToken(token),
      allowed_provider_keys: ["stripe"], expires_at: new Date(Date.now() + 3600000).toISOString(),
    }).select("id").single();
    if (error || !data) throw new Error("Secure Stripe setup could not be prepared.");
  }
  return { url: `${getAppUrl()}${connectionSetupPath(token)}`, detail: "Open the existing secure Stripe setup, or have your operator complete it. A restricted read key is required; this does not connect or activate the account by itself." };
}
