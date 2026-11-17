import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAppUrl } from "../env";
import { decryptSecret, encryptSecret } from "../integrations/secrets";
import type { ImportScope } from "./import-store";

export async function prepareOwnerIntake(admin: SupabaseClient, scope: Omit<ImportScope, "connectionId">, actorId: string, key: string) {
  z.uuid().parse(key);
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await admin.rpc("prepare_owner_intake", {
    p_partner: scope.partnerId, p_client: scope.clientId, p_actor: actorId,
    p_key: key, p_encrypted: encryptSecret(token), p_last_four: token.slice(-4),
  });
  if (error || typeof data !== "string") throw new Error("Form intake could not be prepared. Retry with the same request key.");
  const stored = await admin.from("integration_secrets").select("encrypted_value")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId)
    .eq("connection_id", data).eq("secret_kind", "webhook_token").single();
  if (stored.error || !stored.data) throw new Error("The intake token could not be loaded. Retry with the same request key.");
  return {
    connectionId: data, url: `${getAppUrl()}/api/integrations/inbound/${data}`,
    token: decryptSecret(stored.data.encrypted_value), header: "x-webhook-token",
    detail: "Endpoint prepared. Configure your form server to POST submissions with this header; keep its token private. Waiting for a real submission. Importing submissions does not activate agents.",
  };
}
