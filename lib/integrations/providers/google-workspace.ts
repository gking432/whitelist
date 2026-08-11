import type {
  CanonicalObjectType,
  CanonicalRecord,
  ConnectorAdapter,
  ConnectorPage,
  ConnectorPushInput,
} from "../connectors/types";
import {
  mintWorkspaceAccessToken,
  type WorkspaceCredentials,
} from "./workspace-oauth";

const PEOPLE = "https://people.googleapis.com/v1";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1";

async function googleFetch(
  credentials: WorkspaceCredentials,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await mintWorkspaceAccessToken("google_workspace", credentials);
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google Workspace API failed (${response.status}).`);
  return response;
}

function firstValue(values: unknown, field: string): string | null {
  if (!Array.isArray(values)) return null;
  const first = values[0] as Record<string, unknown> | undefined;
  return typeof first?.[field] === "string" ? (first[field] as string) : null;
}

export function mapGoogleContact(source: Record<string, unknown>): CanonicalRecord {
  const names = Array.isArray(source.names) ? source.names : [];
  const name = (names[0] ?? {}) as Record<string, unknown>;
  return {
    objectType: "customer",
    externalId: String(source.resourceName ?? "").replace("people/", ""),
    updatedAt:
      typeof (source.metadata as Record<string, unknown> | undefined)?.sources === "object"
        ? null
        : null,
    data: {
      name: typeof name.displayName === "string" ? name.displayName : null,
      first_name: typeof name.givenName === "string" ? name.givenName : null,
      last_name: typeof name.familyName === "string" ? name.familyName : null,
      email: firstValue(source.emailAddresses, "value"),
      phone: firstValue(source.phoneNumbers, "value"),
    },
    source,
  };
}

export function mapGoogleEvent(source: Record<string, unknown>): CanonicalRecord {
  const start = (source.start ?? {}) as Record<string, unknown>;
  const end = (source.end ?? {}) as Record<string, unknown>;
  return {
    objectType: "appointment",
    externalId: String(source.id ?? ""),
    updatedAt: typeof source.updated === "string" ? source.updated : null,
    data: {
      title: typeof source.summary === "string" ? source.summary : null,
      description: typeof source.description === "string" ? source.description : null,
      start_at: start.dateTime ?? start.date ?? null,
      end_at: end.dateTime ?? end.date ?? null,
      status: source.status ?? null,
      html_url: source.htmlLink ?? null,
    },
    source,
  };
}

function pageToken(cursor: Record<string, unknown> | null): string | null {
  return typeof cursor?.pageToken === "string" ? cursor.pageToken : null;
}

async function pullGooglePage(
  credentials: WorkspaceCredentials,
  objectType: CanonicalObjectType,
  cursor: Record<string, unknown> | null,
): Promise<ConnectorPage> {
  const token = pageToken(cursor);
  if (objectType === "customer") {
    const params = new URLSearchParams({
      personFields: "names,emailAddresses,phoneNumbers,addresses,organizations,metadata",
      pageSize: "100",
      ...(token ? { pageToken: token } : {}),
    });
    const body = (await (await googleFetch(credentials, `${PEOPLE}/people/me/connections?${params}`)).json()) as {
      connections?: Record<string, unknown>[];
      nextPageToken?: string;
    };
    return {
      records: (body.connections ?? []).map(mapGoogleContact),
      nextCursor: body.nextPageToken ? { pageToken: body.nextPageToken } : null,
    };
  }
  if (objectType === "appointment") {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "100",
      ...(token ? { pageToken: token } : {}),
    });
    const body = (await (await googleFetch(credentials, `${CALENDAR}/calendars/primary/events?${params}`)).json()) as {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
    };
    return {
      records: (body.items ?? []).map(mapGoogleEvent),
      nextCursor: body.nextPageToken ? { pageToken: body.nextPageToken } : null,
    };
  }
  if (objectType === "message") {
    const params = new URLSearchParams({ maxResults: "25", ...(token ? { pageToken: token } : {}) });
    const body = (await (await googleFetch(credentials, `${GMAIL}/users/me/messages?${params}`)).json()) as {
      messages?: { id: string; threadId?: string }[];
      nextPageToken?: string;
    };
    const accessToken = await mintWorkspaceAccessToken("google_workspace", credentials);
    const details = await Promise.all((body.messages ?? []).map(async (message) => {
      const detailParams = new URLSearchParams({ format: "metadata" });
      for (const header of ["From", "To", "Subject", "Date"]) {
        detailParams.append("metadataHeaders", header);
      }
      const response = await fetch(
        `${GMAIL}/users/me/messages/${encodeURIComponent(message.id)}?${detailParams}`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (!response.ok) throw new Error(`Gmail message read failed (${response.status}).`);
      return await response.json() as {
        id: string;
        threadId?: string;
        internalDate?: string;
        snippet?: string;
        labelIds?: string[];
        payload?: { headers?: { name: string; value: string }[] };
      };
    }));
    return {
      records: details.map((message) => {
        const headers = Object.fromEntries(
          (message.payload?.headers ?? []).map((header) => [header.name.toLowerCase(), header.value]),
        );
        return {
        objectType: "message" as const,
        externalId: message.id,
        externalParentId: message.threadId ?? null,
        updatedAt: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : null,
        data: {
          provider: "gmail",
          from: headers.from ?? null,
          to: headers.to ?? null,
          subject: headers.subject ?? null,
          preview: message.snippet ?? null,
          is_read: !(message.labelIds ?? []).includes("UNREAD"),
        },
        source: message,
      }}),
      nextCursor: body.nextPageToken ? { pageToken: body.nextPageToken } : null,
    };
  }
  throw new Error(`Google Workspace cannot pull ${objectType}.`);
}

function text(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === "string" ? String(data[key]) : "";
}

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

async function pushGoogleRecord(
  credentials: WorkspaceCredentials,
  input: ConnectorPushInput,
) {
  if (input.objectType === "customer" && input.operation === "create") {
    const response = await googleFetch(credentials, `${PEOPLE}/people:createContact`, {
      method: "POST",
      body: JSON.stringify({
        names: [{ givenName: text(input.data, "first_name"), familyName: text(input.data, "last_name"), displayName: text(input.data, "name") }],
        emailAddresses: text(input.data, "email") ? [{ value: text(input.data, "email") }] : [],
        phoneNumbers: text(input.data, "phone") ? [{ value: text(input.data, "phone") }] : [],
      }),
    });
    const created = (await response.json()) as { resourceName?: string };
    return { externalObjectId: String(created.resourceName ?? "").replace("people/", ""), source: created };
  }

  if (input.objectType === "appointment") {
    const eventId = input.externalObjectId;
    if (input.operation === "delete" && eventId) {
      await googleFetch(credentials, `${CALENDAR}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" });
      return { externalObjectId: eventId };
    }
    const response = await googleFetch(
      credentials,
      `${CALENDAR}/calendars/primary/events${eventId ? `/${encodeURIComponent(eventId)}` : ""}`,
      {
        method: eventId ? "PATCH" : "POST",
        body: JSON.stringify({
          summary: text(input.data, "title") || "Appointment",
          description: text(input.data, "description"),
          start: { dateTime: text(input.data, "start_at") },
          end: { dateTime: text(input.data, "end_at") },
        }),
      },
    );
    const created = (await response.json()) as { id?: string; updated?: string };
    return { externalObjectId: created.id ?? eventId ?? "", updatedAt: created.updated ?? null, source: created };
  }

  if (input.objectType === "message" && input.operation === "create") {
    const to = text(input.data, "to");
    const subject = text(input.data, "subject");
    const body = text(input.data, "body");
    const raw = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join("\r\n");
    const response = await googleFetch(credentials, `${GMAIL}/users/me/messages/send`, {
      method: "POST",
      body: JSON.stringify({ raw: base64url(raw) }),
    });
    const sent = (await response.json()) as { id?: string; threadId?: string };
    return { externalObjectId: sent.id ?? "", externalParentId: sent.threadId ?? null, source: sent };
  }

  throw new Error(`Google Workspace cannot ${input.operation} ${input.objectType}.`);
}

export async function getGoogleWorkspaceBusyIntervals(
  credentials: WorkspaceCredentials,
  timeMin: string,
  timeMax: string,
): Promise<{ start: string; end: string }[]> {
  const response = await googleFetch(credentials, `${CALENDAR}/freeBusy`, {
    method: "POST",
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: "primary" }] }),
  });
  const body = (await response.json()) as { calendars?: { primary?: { busy?: { start: string; end: string }[] } } };
  return body.calendars?.primary?.busy ?? [];
}

export async function sendGoogleWorkspaceEmail(
  credentials: WorkspaceCredentials,
  message: { to: string; subject: string; body: string; idempotencyKey: string },
): Promise<{ messageId: string }> {
  const result = await pushGoogleRecord(credentials, {
    operation: "create",
    objectType: "message",
    nativeObjectId: message.idempotencyKey,
    data: message,
    idempotencyKey: message.idempotencyKey,
  });
  return { messageId: result.externalObjectId };
}

export const googleWorkspaceAdapter: ConnectorAdapter<WorkspaceCredentials> = {
  manifest: {
    key: "google_workspace",
    name: "Google Workspace",
    category: "productivity",
    description: "Google Contacts, Calendar, and Gmail through one authorization.",
    authStrategy: "oauth2",
    capabilities: [
      "customer.read", "customer.create",
      "appointment.read", "appointment.create", "appointment.update", "appointment.delete",
      "message.read", "message.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://developers.google.com/workspace",
  },
  async testConnection(context) {
    try {
      const response = await googleFetch(context.credentials, "https://www.googleapis.com/oauth2/v2/userinfo");
      const account = (await response.json()) as { id?: string; email?: string; name?: string };
      return {
        ok: true,
        detail: "Google Workspace connected. Gmail, Calendar, and Contacts are ready.",
        externalAccountId: account.id,
        externalAccountName: account.email ?? account.name,
      };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : "Google Workspace verification failed." };
    }
  },
  pullPage(context, objectType, cursor) {
    return pullGooglePage(context.credentials, objectType, cursor);
  },
  pushRecord(context, input) {
    return pushGoogleRecord(context.credentials, input);
  },
};
