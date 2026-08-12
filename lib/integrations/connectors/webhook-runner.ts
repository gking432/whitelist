import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import { encryptSecret, secretLastFour } from "@/lib/integrations/secrets";
import { getConnectorAdapter } from "./adapters";
import {
  webhookRenewalCutoff,
  webhookRenewalRetryReady,
} from "./webhook-policy";

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

export async function renewExpiringConnectionWebhooks(
  admin: SupabaseClient,
  limit = 20,
) {
  const now = Date.now();
  const { data, error } = await admin
    .from("integration_webhook_registrations")
    .select(
      "id, connection_id, partner_id, client_id, status, updated_at, metadata, connection:integration_connections!inner(status, provider:integration_providers!inner(provider_key))",
    )
    .in("status", ["active", "expiring", "failed"])
    .lte("expires_at", webhookRenewalCutoff(now))
    .order("expires_at", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Could not load expiring webhooks: ${error.message}`);

  let renewed = 0;
  let failed = 0;
  let skipped = 0;
  const seenConnections = new Set<string>();

  for (const row of data ?? []) {
    if (seenConnections.has(row.connection_id)) continue;
    seenConnections.add(row.connection_id);
    if (!webhookRenewalRetryReady(row.status, row.updated_at, now)) {
      skipped += 1;
      continue;
    }

    const connection = row.connection as unknown as {
      status?: string;
      provider?: { provider_key?: string };
    };
    const providerKey = connection.provider?.provider_key;
    if (connection.status !== "connected" || !providerKey) {
      skipped += 1;
      continue;
    }

    const { data: claimed } = await admin
      .from("integration_webhook_registrations")
      .update({ status: "expiring" })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("updated_at", row.updated_at)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const result = await registerConnectionWebhooks(admin, {
        connectionId: row.connection_id,
        partnerId: row.partner_id,
        clientId: row.client_id,
        providerKey,
      });
      if (result.registered === 0) {
        throw new Error(result.detail);
      }
      renewed += 1;
    } catch (renewalError) {
      await admin
        .from("integration_webhook_registrations")
        .update({
          status: "failed",
          metadata: {
            ...(row.metadata ?? {}),
            renewal_error:
              renewalError instanceof Error
                ? renewalError.message
                : "Webhook renewal failed.",
          },
        })
        .eq("id", row.id);
      failed += 1;
    }
  }

  return { checked: seenConnections.size, renewed, failed, skipped };
}
