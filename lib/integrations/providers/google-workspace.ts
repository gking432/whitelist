import { googleBusyIntervals } from "./calendar-availability.ts";
import type {
  CanonicalObjectType,
  CanonicalRecord,
  ConnectorAdapter,
  ConnectorPage,
  ConnectorPushInput,
} from "../connectors/types";
import { connectorPushPayload } from "../connectors/field-mappings.ts";
import {
  mintWorkspaceAccessToken,
  type WorkspaceCredentials,
  workspaceApiRequiresReconnect,
} from "./workspace-oauth.ts";
import { ConnectorAuthorizationError, ConnectorHttpError, parseRetryAfter } from "../connectors/errors.ts";

const PEOPLE = "https://people.googleapis.com/v1";
const CALENDAR = "https://www.googleapis.com/calendar/v3";
const GMAIL = "https://gmail.googleapis.com/gmail/v1";

class GoogleWorkspaceApiError extends ConnectorHttpError {
  readonly status: number;
  readonly responseBody: string;

  constructor(
    status: number,
    responseBody: string,
    retryAfter: string | null = null,
  ) {
    super(`Google Workspace API failed (${status}).`, status, parseRetryAfter(retryAfter));
    this.status = status;
    this.responseBody = responseBody;
  }
}

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
  if (!response.ok) {
    if (workspaceApiRequiresReconnect(response.status)) {
      throw new ConnectorAuthorizationError();
    }
    throw new GoogleWorkspaceApiError(response.status, await response.text(), response.headers.get("retry-after"));
  }
  return response;
}

function expiredGoogleCursor(error: unknown): boolean {
  return error instanceof GoogleWorkspaceApiError &&
    (error.status === 410 ||
      (error.status === 400 && error.responseBody.includes("EXPIRED_SYNC_TOKEN")));
}

function firstValue(values: unknown, field: string): string | null {
  if (!Array.isArray(values)) return null;
  const first = values[0] as Record<string, unknown> | undefined;
  return typeof first?.[field] === "string" ? (first[field] as string) : null;
}

export function mapGoogleContact(source: Record<string, unknown>): CanonicalRecord {
  const names = Array.isArray(source.names) ? source.names : [];
  const name = (names[0] ?? {}) as Record<string, unknown>;
  const metadata = (source.metadata ?? {}) as Record<string, unknown>;
  return {
    objectType: "customer",
    externalId: String(source.resourceName ?? "").replace("people/", ""),
    deleted: metadata.deleted === true,
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
    deleted: source.status === "cancelled",
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

function cursorToken(
  cursor: Record<string, unknown> | null,
  key: "syncToken" | "historyId" | "fullSyncHistoryId",
): string | null {
  return typeof cursor?.[key] === "string" ? String(cursor[key]) : null;
}

async function readGmailMessages(
  credentials: WorkspaceCredentials,
  messages: { id: string; threadId?: string }[],
): Promise<CanonicalRecord[]> {
  const unique = [...new Map(messages.map((message) => [message.id, message])).values()];
  const details = await Promise.all(unique.map(async (message) => {
    const detailParams = new URLSearchParams({ format: "metadata" });
    for (const header of ["From", "To", "Subject", "Date"]) {
      detailParams.append("metadataHeaders", header);
    }
    const response = await googleFetch(
      credentials,
      `${GMAIL}/users/me/messages/${encodeURIComponent(message.id)}?${detailParams}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    return await response.json() as {
      id: string;
      threadId?: string;
      internalDate?: string;
      snippet?: string;
      labelIds?: string[];
      payload?: { headers?: { name: string; value: string }[] };
    };
  }));

  return details.map((message) => {
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
    };
  });
}

export function mapDeletedGmailMessage(message: {
  id: string;
  threadId?: string;
}): CanonicalRecord {
  return {
    objectType: "message",
    externalId: message.id,
    externalParentId: message.threadId ?? null,
    deleted: true,
    data: {},
    source: { id: message.id, threadId: message.threadId, deleted: true },
  };
}

async function pullGooglePage(
  credentials: WorkspaceCredentials,
  objectType: CanonicalObjectType,
  cursor: Record<string, unknown> | null,
): Promise<ConnectorPage> {
  const token = pageToken(cursor);
  if (objectType === "customer") {
    const syncToken = cursorToken(cursor, "syncToken");
    const params = new URLSearchParams({
      personFields: "names,emailAddresses,phoneNumbers,addresses,organizations,metadata",
      pageSize: "100",
      requestSyncToken: "true",
      ...(token ? { pageToken: token } : {}),
      ...(syncToken ? { syncToken } : {}),
    });
    let body: {
      connections?: Record<string, unknown>[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    try {
      body = await (await googleFetch(credentials, `${PEOPLE}/people/me/connections?${params}`)).json() as typeof body;
    } catch (error) {
      if (syncToken && expiredGoogleCursor(error)) {
        return pullGooglePage(credentials, objectType, null);
      }
      throw error;
    }
    const nextCursor = body.nextPageToken
      ? { ...(syncToken ? { syncToken } : {}), pageToken: body.nextPageToken }
      : body.nextSyncToken
        ? { syncToken: body.nextSyncToken }
        : null;
    return {
      records: (body.connections ?? []).map(mapGoogleContact),
      nextCursor,
      continueImmediately: Boolean(body.nextPageToken),
    };
  }
  if (objectType === "appointment") {
    const syncToken = cursorToken(cursor, "syncToken");
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "true",
      maxResults: "100",
      ...(token ? { pageToken: token } : {}),
      ...(syncToken ? { syncToken } : {}),
    });
    let body: {
      items?: Record<string, unknown>[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    try {
      body = await (await googleFetch(credentials, `${CALENDAR}/calendars/primary/events?${params}`)).json() as typeof body;
    } catch (error) {
      if (syncToken && expiredGoogleCursor(error)) {
        return pullGooglePage(credentials, objectType, null);
      }
      throw error;
    }
    const nextCursor = body.nextPageToken
      ? { ...(syncToken ? { syncToken } : {}), pageToken: body.nextPageToken }
      : body.nextSyncToken
        ? { syncToken: body.nextSyncToken }
        : null;
    return {
      records: (body.items ?? []).map(mapGoogleEvent),
      nextCursor,
      continueImmediately: Boolean(body.nextPageToken),
    };
  }
  if (objectType === "message") {
    const historyId = cursorToken(cursor, "historyId");
    if (historyId) {
      const historyParams = new URLSearchParams({
        startHistoryId: historyId,
        maxResults: "100",
        ...(token ? { pageToken: token } : {}),
      });
      let body: {
        history?: {
          messages?: { id: string; threadId?: string }[];
          messagesDeleted?: { message: { id: string; threadId?: string } }[];
        }[];
        nextPageToken?: string;
        historyId?: string;
      };
      try {
        body = await (await googleFetch(
          credentials,
          `${GMAIL}/users/me/history?${historyParams}`,
        )).json() as typeof body;
      } catch (error) {
        if (error instanceof GoogleWorkspaceApiError && error.status === 404) {
          return pullGooglePage(credentials, objectType, null);
        }
        throw error;
      }
      const deletedIds = new Set(
        (body.history ?? []).flatMap((entry) =>
          (entry.messagesDeleted ?? []).map((item) => item.message.id),
        ),
      );
      const messages = (body.history ?? [])
        .flatMap((entry) => entry.messages ?? [])
        .filter((message) => !deletedIds.has(message.id));
      const deleted = (body.history ?? []).flatMap((entry) =>
        (entry.messagesDeleted ?? []).map((item) =>
          mapDeletedGmailMessage(item.message),
        ),
      );
      return {
        records: [...await readGmailMessages(credentials, messages), ...deleted],
        nextCursor: body.nextPageToken
          ? { historyId, pageToken: body.nextPageToken }
          : { historyId: body.historyId ?? historyId },
        continueImmediately: Boolean(body.nextPageToken),
      };
    }
    const fullSyncHistoryId = cursorToken(cursor, "fullSyncHistoryId") ??
      await (async () => {
        const profile = await (await googleFetch(credentials, `${GMAIL}/users/me/profile`)).json() as { historyId?: string };
        return profile.historyId ?? null;
      })();
    const params = new URLSearchParams({ maxResults: "25", ...(token ? { pageToken: token } : {}) });
    const body = (await (await googleFetch(credentials, `${GMAIL}/users/me/messages?${params}`)).json()) as {
      messages?: { id: string; threadId?: string }[];
      nextPageToken?: string;
    };
    const nextCursor = body.nextPageToken
      ? {
          ...(fullSyncHistoryId ? { fullSyncHistoryId } : {}),
          pageToken: body.nextPageToken,
        }
      : fullSyncHistoryId
        ? { historyId: fullSyncHistoryId }
        : null;
    return {
      records: await readGmailMessages(credentials, body.messages ?? []),
      nextCursor,
      continueImmediately: Boolean(body.nextPageToken),
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
      body: JSON.stringify(connectorPushPayload(input.externalData, {
        names: [{ givenName: text(input.data, "first_name"), familyName: text(input.data, "last_name"), displayName: text(input.data, "name") }],
        emailAddresses: text(input.data, "email") ? [{ value: text(input.data, "email") }] : [],
        phoneNumbers: text(input.data, "phone") ? [{ value: text(input.data, "phone") }] : [],
      })),
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
        body: JSON.stringify(connectorPushPayload(input.externalData, {
          summary: text(input.data, "title") || "Appointment",
          description: text(input.data, "description"),
          start: { dateTime: text(input.data, "start_at") },
          end: { dateTime: text(input.data, "end_at") },
        })),
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
      body: JSON.stringify(connectorPushPayload(input.externalData, { raw: base64url(raw) })),
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
  return googleBusyIntervals(body);
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
