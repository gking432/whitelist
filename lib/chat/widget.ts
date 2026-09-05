import { randomBytes } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

// Widget key resolution. The widget key is PUBLIC by design (it ships in
// the client's website markup), so it grants exactly one thing: starting a
// visitor chat with that client's assistant. It is distinct from the
// inbound webhook token (secret) and can be rotated independently.

export type WidgetConnection = {
  id: string;
  partner_id: string;
  client_id: string;
  status: string;
  client_name: string;
};

export function generateWidgetKey(): string {
  return `wk_${randomBytes(18).toString("base64url")}`;
}

export async function findConnectionByWidgetKey(
  admin: SupabaseClient,
  widgetKey: string,
): Promise<WidgetConnection | null> {
  if (!/^wk_[A-Za-z0-9_-]{20,}$/.test(widgetKey)) {
    return null;
  }

  const { data } = await admin
    .from("integration_connections")
    .select(
      "id, partner_id, client_id, status, config, client:client_businesses!integration_connections_client_id_fkey(name), provider:integration_providers!integration_connections_provider_id_fkey!inner(provider_key)",
    )
    .eq("provider.provider_key", "northstar_web_chat")
    .eq("config->>widget_public_key", widgetKey)
    .limit(1)
    .maybeSingle();

  if (!data) {
    return null;
  }

  const row = data as unknown as {
    id: string;
    partner_id: string;
    client_id: string;
    status: string;
    client: { name: string } | null;
  };

  if (["paused", "disabled"].includes(row.status)) {
    return null;
  }

  return {
    id: row.id,
    partner_id: row.partner_id,
    client_id: row.client_id,
    status: row.status,
    client_name: row.client?.name ?? "this business",
  };
}
