import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import { encryptSecret, secretLastFour } from "@/lib/integrations/secrets";
import { getConnectorAdapter } from "./adapters";

export async function registerConnectionWebhooks(admin: SupabaseClient, input: { connectionId: string; partnerId: string; clientId: string; providerKey: string }) {
  const appUrl = getAppUrl().replace(/\/$/, "");
  if (!appUrl.startsWith("https://")) return { registered: 0, detail: "Webhook activation waits for the public HTTPS deployment." };
  const adapter = getConnectorAdapter(input.providerKey);
  if (!adapter?.registerWebhooks) return { registered: 0, detail: "This connector does not require webhooks." };
  const credentials = await readProviderCredentials(admin, input.connectionId);
  if (!credentials) throw new Error("Provider credentials are unavailable for webhook registration.");
  const endpoint = `${appUrl}/api/integrations/inbound/phone/${input.providerKey}/${input.connectionId}`;
  const registrations = await adapter.registerWebhooks({ connectionId: input.connectionId, partnerId: input.partnerId, clientId: input.clientId, credentials, config: {} }, endpoint);
  for (const registration of registrations) {
    const secretKind = `provider_webhook_secret:${registration.eventType}`;
    if (registration.secret) {
      await admin.from("integration_secrets").upsert({ partner_id: input.partnerId, client_id: input.clientId, connection_id: input.connectionId, secret_kind: secretKind, encrypted_value: encryptSecret(registration.secret), last_four: secretLastFour(registration.secret), updated_at: new Date().toISOString() }, { onConflict: "connection_id,secret_kind" });
    }
    await admin.from("integration_webhook_registrations").upsert({ partner_id: input.partnerId, client_id: input.clientId, connection_id: input.connectionId, event_type: registration.eventType, endpoint_path: new URL(registration.endpointUrl).pathname, external_registration_id: registration.externalRegistrationId ?? null, status: "active", expires_at: registration.expiresAt ?? null, last_verified_at: new Date().toISOString(), metadata: registration.metadata ?? {} }, { onConflict: "connection_id,event_type,endpoint_path" });
  }
  return { registered: registrations.length, detail: `${registrations.length} provider webhook${registrations.length === 1 ? "" : "s"} activated.` };
}
