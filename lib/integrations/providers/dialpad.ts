import { connectorHttpError } from "../connectors/errors.ts";
import { randomBytes } from "node:crypto";

import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage } from "../connectors/types";

export type DialpadCredentials = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
};

const BASE = "https://dialpad.com/api/v2";

async function dialpadFetch(credentials: DialpadCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("dialpad", response);
  return response;
}

function mapCall(source: Record<string, unknown>): CanonicalRecord {
  const phone = source.external_number ?? source.contact?.toString() ?? null;
  return { objectType: "lead", externalId: String(source.call_id ?? source.id ?? ""), updatedAt: typeof source.date_started === "string" ? source.date_started : null, data: { name: source.name ?? "Phone caller", phone, title: `Call from ${phone ?? "unknown caller"}`, description: source.call_summary ?? source.transcription_text ?? null, status: source.was_connected ? "contacted" : "new", source: "dialpad", medium: "phone", direction: source.direction ?? null, duration: source.duration ?? null }, source };
}

export const dialpadAdapter: ConnectorAdapter<DialpadCredentials> = {
  manifest: {
    key: "dialpad", name: "Dialpad", category: "phone",
    description: "Live call and SMS events plus call history for businesses keeping Dialpad.",
    authStrategy: "oauth2", capabilities: ["lead.read", "message.webhook", "lead.webhook"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.dialpad.com/docs", webhookEvents: ["call.ringing", "call.completed", "message.received"],
  },
  async testConnection(context) {
    try {
      await dialpadFetch(context.credentials, "/call?limit=1");
      return { ok: true, detail: "Dialpad connected. Calls and messages can now open the assistant and sync into the CRM.", externalAccountName: "Dialpad company" };
    } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Dialpad verification failed." }; }
  },
  async pullPage(context, objectType: CanonicalObjectType, cursor): Promise<ConnectorPage> {
    if (objectType !== "lead") throw new Error(`Dialpad cannot pull ${objectType}.`);
    const query = new URLSearchParams({ limit: "100" });
    if (typeof cursor?.cursor === "string") query.set("cursor", cursor.cursor);
    const body = await (await dialpadFetch(context.credentials, `/call?${query}`)).json() as { items?: Record<string, unknown>[]; cursor?: string };
    return { records: (body.items ?? []).map(mapCall), nextCursor: body.cursor ? { cursor: body.cursor } : null };
  },
  async registerWebhooks(context, endpointBaseUrl) {
    const secret = randomBytes(32).toString("base64url");
    const hook = await (await dialpadFetch(context.credentials, "/webhooks", { method: "POST", body: JSON.stringify({ hook_url: endpointBaseUrl, secret }) })).json() as { id?: number };
    if (!hook.id) throw new Error("Dialpad did not return a webhook endpoint ID.");
    const call = await (await dialpadFetch(context.credentials, "/subscriptions/call", { method: "POST", body: JSON.stringify({ endpoint_id: hook.id, call_states: ["ringing", "connected", "hangup"], enabled: true }) })).json() as { id?: number };
    const sms = await (await dialpadFetch(context.credentials, "/subscriptions/sms", { method: "POST", body: JSON.stringify({ endpoint_id: hook.id, direction: "all", enabled: true, status: false }) })).json() as { id?: number };
    return [{ eventType: "phone.events", endpointUrl: endpointBaseUrl, externalRegistrationId: String(hook.id), secret, metadata: { call_subscription_id: call.id ?? null, sms_subscription_id: sms.id ?? null } }];
  },
};
