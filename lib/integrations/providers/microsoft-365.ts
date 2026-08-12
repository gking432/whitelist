import type {
  CanonicalObjectType,
  CanonicalRecord,
  ConnectorAdapter,
  ConnectorPage,
  ConnectorPushInput,
} from "../connectors/types";
import { connectorPushPayload } from "../connectors/field-mappings.ts";
import { mintWorkspaceAccessToken, type WorkspaceCredentials } from "./workspace-oauth.ts";

const GRAPH = "https://graph.microsoft.com/v1.0";

async function graphFetch(credentials: WorkspaceCredentials, path: string, init: RequestInit = {}) {
  const token = await mintWorkspaceAccessToken("microsoft_365", credentials);
  const response = await fetch(path.startsWith("http") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Microsoft Graph failed (${response.status}).`);
  return response;
}

export function mapMicrosoftContact(source: Record<string, unknown>): CanonicalRecord {
  const emails = Array.isArray(source.emailAddresses) ? source.emailAddresses : [];
  const email = (emails[0] ?? {}) as Record<string, unknown>;
  const phones = Array.isArray(source.businessPhones) ? source.businessPhones : [];
  return {
    objectType: "customer",
    externalId: String(source.id ?? ""),
    data: {
      name: source.displayName ?? null,
      first_name: source.givenName ?? null,
      last_name: source.surname ?? null,
      email: email.address ?? null,
      phone: phones[0] ?? source.mobilePhone ?? null,
    },
    source,
  };
}

export function mapMicrosoftEvent(source: Record<string, unknown>): CanonicalRecord {
  const start = (source.start ?? {}) as Record<string, unknown>;
  const end = (source.end ?? {}) as Record<string, unknown>;
  const body = (source.body ?? {}) as Record<string, unknown>;
  return {
    objectType: "appointment",
    externalId: String(source.id ?? ""),
    data: {
      title: source.subject ?? null,
      description: body.content ?? null,
      start_at: start.dateTime ?? null,
      end_at: end.dateTime ?? null,
      timezone: start.timeZone ?? null,
      status: source.isCancelled === true ? "cancelled" : "booked",
      html_url: source.webLink ?? null,
    },
    source,
  };
}

function text(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === "string" ? String(data[key]) : "";
}

async function pullMicrosoftPage(credentials: WorkspaceCredentials, objectType: CanonicalObjectType, cursor: Record<string, unknown> | null): Promise<ConnectorPage> {
  const nextLink = typeof cursor?.nextLink === "string" ? cursor.nextLink : null;
  const path = nextLink ?? (objectType === "customer"
    ? "/me/contacts?$top=100"
    : objectType === "appointment"
      ? "/me/events?$top=100&$orderby=lastModifiedDateTime%20desc"
      : objectType === "message"
        ? "/me/messages?$top=100&$select=id,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead"
        : null);
  if (!path) throw new Error(`Microsoft 365 cannot pull ${objectType}.`);
  const body = (await (await graphFetch(credentials, path)).json()) as { value?: Record<string, unknown>[]; "@odata.nextLink"?: string };
  const records = (body.value ?? []).map((item) => {
    if (objectType === "customer") return mapMicrosoftContact(item);
    if (objectType === "appointment") return mapMicrosoftEvent(item);
    return {
      objectType: "message" as const,
      externalId: String(item.id ?? ""),
      externalParentId: typeof item.conversationId === "string" ? item.conversationId : null,
      updatedAt: typeof item.receivedDateTime === "string" ? item.receivedDateTime : null,
      data: {
        subject: item.subject ?? null,
        preview: item.bodyPreview ?? null,
        is_read: item.isRead ?? null,
      },
      source: item,
    };
  });
  return { records, nextCursor: body["@odata.nextLink"] ? { nextLink: body["@odata.nextLink"] } : null };
}

async function pushMicrosoftRecord(credentials: WorkspaceCredentials, input: ConnectorPushInput) {
  if (input.objectType === "customer") {
    const id = input.externalObjectId;
    if (input.operation === "delete" && id) {
      await graphFetch(credentials, `/me/contacts/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { externalObjectId: id };
    }
    const response = await graphFetch(credentials, `/me/contacts${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(connectorPushPayload(input.externalData, {
        givenName: text(input.data, "first_name"),
        surname: text(input.data, "last_name"),
        displayName: text(input.data, "name"),
        emailAddresses: text(input.data, "email") ? [{ address: text(input.data, "email"), name: text(input.data, "name") }] : [],
        businessPhones: text(input.data, "phone") ? [text(input.data, "phone")] : [],
      })),
    });
    const created = response.status === 204 ? { id } : (await response.json()) as { id?: string };
    return { externalObjectId: created.id ?? id ?? "", source: created };
  }
  if (input.objectType === "appointment") {
    const id = input.externalObjectId;
    if (input.operation === "delete" && id) {
      await graphFetch(credentials, `/me/events/${encodeURIComponent(id)}`, { method: "DELETE" });
      return { externalObjectId: id };
    }
    const timeZone = text(input.data, "timezone") || "UTC";
    const response = await graphFetch(credentials, `/me/events${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(connectorPushPayload(input.externalData, {
        subject: text(input.data, "title") || "Appointment",
        body: { contentType: "text", content: text(input.data, "description") },
        start: { dateTime: text(input.data, "start_at"), timeZone },
        end: { dateTime: text(input.data, "end_at"), timeZone },
      })),
    });
    const created: { id?: string | null; lastModifiedDateTime?: string } =
      response.status === 204
        ? { id }
        : await response.json() as { id?: string; lastModifiedDateTime?: string };
    return { externalObjectId: created.id ?? id ?? "", updatedAt: created.lastModifiedDateTime ?? null, source: created };
  }
  if (input.objectType === "message" && input.operation === "create") {
    await graphFetch(credentials, "/me/sendMail", {
      method: "POST",
      body: JSON.stringify(connectorPushPayload(input.externalData, { message: {
        subject: text(input.data, "subject"),
        body: { contentType: "Text", content: text(input.data, "body") },
        toRecipients: [{ emailAddress: { address: text(input.data, "to") } }],
      }, saveToSentItems: true })),
    });
    return { externalObjectId: `sent-${input.idempotencyKey}` };
  }
  throw new Error(`Microsoft 365 cannot ${input.operation} ${input.objectType}.`);
}

export async function getMicrosoftBusyIntervals(credentials: WorkspaceCredentials, timeMin: string, timeMax: string): Promise<{ start: string; end: string }[]> {
  const me = (await (await graphFetch(credentials, "/me?$select=mail,userPrincipalName")).json()) as { mail?: string; userPrincipalName?: string };
  const address = me.mail ?? me.userPrincipalName;
  if (!address) throw new Error("Microsoft account has no calendar address.");
  const response = await graphFetch(credentials, "/me/calendar/getSchedule", {
    method: "POST",
    body: JSON.stringify({ schedules: [address], startTime: { dateTime: timeMin, timeZone: "UTC" }, endTime: { dateTime: timeMax, timeZone: "UTC" }, availabilityViewInterval: 30 }),
  });
  const body = (await response.json()) as { value?: { scheduleItems?: { start?: { dateTime?: string }; end?: { dateTime?: string } }[] }[] };
  return (body.value?.[0]?.scheduleItems ?? []).flatMap((item) => item.start?.dateTime && item.end?.dateTime ? [{ start: item.start.dateTime, end: item.end.dateTime }] : []);
}

export async function createMicrosoftCalendarEvent(
  credentials: WorkspaceCredentials,
  event: { summary: string; description: string; startIso: string; endIso: string; timeZone?: string },
): Promise<{ eventId: string; htmlLink: string | null }> {
  const result = await pushMicrosoftRecord(credentials, {
    operation: "create",
    objectType: "appointment",
    nativeObjectId: "approved-booking",
    data: {
      title: event.summary,
      description: event.description,
      start_at: event.startIso,
      end_at: event.endIso,
      timezone: event.timeZone ?? "UTC",
    },
    idempotencyKey: `calendar-${event.startIso}`,
  });
  const source = (result.source ?? {}) as Record<string, unknown>;
  return {
    eventId: result.externalObjectId,
    htmlLink: typeof source.webLink === "string" ? source.webLink : null,
  };
}

export async function sendMicrosoft365Email(
  credentials: WorkspaceCredentials,
  message: { to: string; subject: string; body: string; idempotencyKey: string },
): Promise<{ messageId: string }> {
  const result = await pushMicrosoftRecord(credentials, {
    operation: "create",
    objectType: "message",
    nativeObjectId: message.idempotencyKey,
    data: message,
    idempotencyKey: message.idempotencyKey,
  });
  return { messageId: result.externalObjectId };
}

export const microsoft365Adapter: ConnectorAdapter<WorkspaceCredentials> = {
  manifest: {
    key: "microsoft_365",
    name: "Microsoft 365",
    category: "productivity",
    description: "Outlook Contacts, Calendar, and Mail through Microsoft Graph.",
    authStrategy: "oauth2",
    capabilities: [
      "customer.read", "customer.create", "customer.update", "customer.delete",
      "appointment.read", "appointment.create", "appointment.update", "appointment.delete",
      "message.read", "message.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://learn.microsoft.com/graph/overview",
  },
  async testConnection(context) {
    try {
      const response = await graphFetch(context.credentials, "/me?$select=id,displayName,mail,userPrincipalName");
      const account = (await response.json()) as { id?: string; displayName?: string; mail?: string; userPrincipalName?: string };
      return { ok: true, detail: "Microsoft 365 connected. Outlook Mail, Calendar, and Contacts are ready.", externalAccountId: account.id, externalAccountName: account.mail ?? account.userPrincipalName ?? account.displayName };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Microsoft 365 verification failed." };
    }
  },
  pullPage(context, objectType, cursor) { return pullMicrosoftPage(context.credentials, objectType, cursor); },
  pushRecord(context, input) { return pushMicrosoftRecord(context.credentials, input); },
};
