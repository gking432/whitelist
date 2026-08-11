import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage } from "../connectors/types";

export type OpenPhoneCredentials = { apiKey: string; phoneNumberIds?: string };
const BASE = "https://api.openphone.com/v1";

async function openPhoneFetch(credentials: OpenPhoneCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { Authorization: credentials.apiKey, "Content-Type": "application/json", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Quo API failed (${response.status}).`);
  return response;
}

function mapCall(source: Record<string, unknown>): CanonicalRecord {
  const participants = Array.isArray(source.participants) ? source.participants : [];
  const phone = participants.find((value) => typeof value === "string") ?? null;
  return { objectType: "lead", externalId: String(source.id ?? ""), updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : null, data: { name: "Phone caller", phone, title: `Call from ${phone ?? "unknown caller"}`, description: source.summary ?? null, status: source.status === "completed" ? "contacted" : "new", source: "openphone", medium: "phone", direction: source.direction ?? null, duration: source.duration ?? null }, source };
}

export const openPhoneAdapter: ConnectorAdapter<OpenPhoneCredentials> = {
  manifest: { key: "openphone", name: "Quo / OpenPhone", category: "phone", description: "Call, transcript, summary, and message events for businesses keeping Quo (formerly OpenPhone).", authStrategy: "api_key", capabilities: ["lead.read", "message.webhook", "lead.webhook"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://www.quo.com/docs/mdx/api-reference", webhookEvents: ["call.ringing", "call.completed", "call.summary.completed", "call.transcript.completed", "message.received"] },
  async testConnection(context) {
    try { await openPhoneFetch(context.credentials, "/calls?maxResults=1"); return { ok: true, detail: "Quo connected. Calls, messages, transcripts, and summaries can now flow into the assistant and CRM.", externalAccountName: "Quo workspace" }; }
    catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Quo verification failed." }; }
  },
  async pullPage(context, objectType: CanonicalObjectType, cursor): Promise<ConnectorPage> {
    if (objectType !== "lead") throw new Error(`Quo cannot pull ${objectType}.`);
    const query = new URLSearchParams({ maxResults: "100" });
    if (typeof cursor?.pageToken === "string") query.set("pageToken", cursor.pageToken);
    const body = await (await openPhoneFetch(context.credentials, `/calls?${query}`)).json() as { data?: Record<string, unknown>[]; nextPageToken?: string };
    return { records: (body.data ?? []).map(mapCall), nextCursor: body.nextPageToken ? { pageToken: body.nextPageToken } : null };
  },
  async registerWebhooks(context, endpointBaseUrl) {
    const resourceIds = context.credentials.phoneNumberIds?.split(",").map((value) => value.trim()).filter(Boolean);
    const common = { url: endpointBaseUrl, ...(resourceIds?.length ? { resourceIds } : {}), label: "AI assistant", status: "enabled" };
    const calls = await (await openPhoneFetch(context.credentials, "/webhooks/calls", { method: "POST", body: JSON.stringify({ ...common, events: ["call.ringing", "call.completed", "call.recording.completed"] }) })).json() as { data?: { id?: string; key?: string } };
    const messages = await (await openPhoneFetch(context.credentials, "/webhooks/messages", { method: "POST", body: JSON.stringify({ ...common, events: ["message.received"] }) })).json() as { data?: { id?: string; key?: string } };
    return [
      { eventType: "calls", endpointUrl: endpointBaseUrl, externalRegistrationId: calls.data?.id ?? null, secret: calls.data?.key },
      { eventType: "messages", endpointUrl: endpointBaseUrl, externalRegistrationId: messages.data?.id ?? null, secret: messages.data?.key },
    ];
  },
};
