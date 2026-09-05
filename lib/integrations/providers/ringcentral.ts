import { connectorHttpError } from "../connectors/errors.ts";
import { randomBytes } from "node:crypto";

import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage } from "../connectors/types";

export type RingCentralCredentials = {
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  accountId?: string;
};

const BASE = "https://platform.ringcentral.com/restapi/v1.0";

async function rcFetch(credentials: RingCentralCredentials, path: string, init: RequestInit = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${credentials.accessToken}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw connectorHttpError("ringcentral", response);
  return response;
}

function mapCall(source: Record<string, unknown>): CanonicalRecord {
  const from = source.from as Record<string, unknown> | undefined;
  const to = source.to as Record<string, unknown> | undefined;
  return {
    objectType: "lead",
    externalId: String(source.id ?? source.sessionId ?? source.telephonySessionId ?? ""),
    updatedAt: typeof source.startTime === "string" ? source.startTime : null,
    data: {
      name: from?.name ?? "Phone caller",
      phone: from?.phoneNumber ?? null,
      title: `Call from ${from?.name ?? from?.phoneNumber ?? "unknown caller"}`,
      description: source.result ?? source.action ?? null,
      status: source.result === "Accepted" ? "contacted" : "new",
      source: "ringcentral",
      medium: "phone",
      direction: source.direction ?? null,
      to_phone: to?.phoneNumber ?? null,
      duration: source.duration ?? null,
    },
    source,
  };
}

export const ringCentralAdapter: ConnectorAdapter<RingCentralCredentials> = {
  manifest: {
    key: "ringcentral",
    name: "RingCentral",
    category: "phone",
    description: "Live call signals, SMS events, and call history for businesses keeping RingCentral.",
    authStrategy: "oauth2",
    capabilities: ["lead.read", "message.webhook", "lead.webhook"],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://developers.ringcentral.com/guide",
    webhookEvents: ["call.ringing", "call.completed", "message.received"],
  },
  async testConnection(context) {
    try {
      const account = await (await rcFetch(context.credentials, "/account/~")).json() as Record<string, unknown>;
      return { ok: true, detail: "RingCentral connected. Calls and messages can now open the assistant and sync into the CRM.", externalAccountId: String(account.id ?? "~"), externalAccountName: String(account.name ?? account.mainNumber ?? "RingCentral account") };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "RingCentral verification failed." };
    }
  },
  async pullPage(context, objectType: CanonicalObjectType, cursor): Promise<ConnectorPage> {
    if (objectType !== "lead") throw new Error(`RingCentral cannot pull ${objectType}.`);
    const pageToken = typeof cursor?.pageToken === "string" ? cursor.pageToken : null;
    const query = new URLSearchParams({ perPage: "100", view: "Detailed" });
    if (pageToken) query.set("pageToken", pageToken);
    const body = await (await rcFetch(context.credentials, `/account/~/call-log?${query}`)).json() as { records?: Record<string, unknown>[]; navigation?: { nextPage?: { uri?: string } } };
    const nextUri = body.navigation?.nextPage?.uri;
    const nextToken = nextUri ? new URL(nextUri).searchParams.get("pageToken") : null;
    return { records: (body.records ?? []).map(mapCall), nextCursor: nextToken ? { pageToken: nextToken } : null };
  },
  async registerWebhooks(context, endpointBaseUrl) {
    const validationToken = randomBytes(32).toString("base64url");
    const response = await rcFetch(context.credentials, "/subscription", {
      method: "POST",
      body: JSON.stringify({
        eventFilters: [
          "/restapi/v1.0/account/~/extension/~/telephony/sessions",
          "/restapi/v1.0/account/~/extension/~/message-store/instant?type=SMS",
        ],
        deliveryMode: { transportType: "WebHook", address: endpointBaseUrl, validationToken },
        expiresIn: 604800,
      }),
    });
    const body = await response.json() as Record<string, unknown>;
    return [{ eventType: "phone.events", endpointUrl: endpointBaseUrl, externalRegistrationId: String(body.id ?? ""), expiresAt: typeof body.expirationTime === "string" ? body.expirationTime : null, secret: validationToken }];
  },
};
