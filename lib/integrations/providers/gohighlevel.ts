// GoHighLevel (LeadConnector) CRM adapter — second CRM of the pilot stack.
// Server-side only, plain fetch against the public v2 API. Uses a Private
// Integration token scoped to one location (sub-account). Same contract as
// the HubSpot adapter: additive contact upsert + AI Assistant note.

import type { ContactFields } from "@/lib/crm/contact-fields";
import { normalizePhone } from "@/lib/phone/normalize";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export type GoHighLevelCredentials = {
  privateToken: string;
  locationId: string;
};

export type GoHighLevelContactMatch = ContactFields & {
  id: string;
};

export class GoHighLevelError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GoHighLevelError";
    this.status = status;
  }
}

async function ghlFetch(
  credentials: GoHighLevelCredentials,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${credentials.privateToken}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Never include response bodies wholesale — they can echo the request.
    throw new GoHighLevelError(
      `GoHighLevel request failed (${response.status}) on ${path.split("?")[0]}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return {};
  }

  return (await response.json()) as Record<string, unknown>;
}

export async function testGoHighLevelConnection(
  credentials: GoHighLevelCredentials,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    const result = await ghlFetch(
      credentials,
      `/locations/${encodeURIComponent(credentials.locationId)}`,
    );

    const location = result.location as { name?: string } | undefined;

    return {
      ok: true,
      detail: `Connected to GoHighLevel location "${location?.name ?? credentials.locationId}". Contact creation and updates are ready.`,
    };
  } catch (error) {
    if (error instanceof GoHighLevelError) {
      return {
        ok: false,
        detail:
          error.status === 401 || error.status === 403
            ? "GoHighLevel rejected the token. Check the Private Integration token and its contacts scopes."
            : `GoHighLevel returned an error (${error.status}). Check the Location ID and try again.`,
      };
    }

    return { ok: false, detail: "Could not reach GoHighLevel." };
  }
}

export async function findGoHighLevelContact(
  credentials: GoHighLevelCredentials,
  input: { phone?: string | null; email?: string | null },
): Promise<GoHighLevelContactMatch | null> {
  const query = input.email?.trim() || input.phone?.trim();

  if (!query) return null;

  const result = await ghlFetch(
    credentials,
    `/contacts/?locationId=${encodeURIComponent(credentials.locationId)}` +
      `&query=${encodeURIComponent(query)}&limit=20`,
  );
  const contacts = (result.contacts ?? []) as {
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    address1?: string | null;
  }[];
  const normalizedPhone = normalizePhone(input.phone);
  const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
  const match = contacts.find((contact) => {
    if (
      normalizedEmail &&
      contact.email?.trim().toLowerCase() === normalizedEmail
    ) {
      return true;
    }

    return (
      normalizedPhone &&
      normalizePhone(contact.phone) === normalizedPhone
    );
  });

  if (!match?.id) return null;

  return {
    id: match.id,
    firstname: match.firstName ?? null,
    lastname: match.lastName ?? null,
    email: match.email ?? null,
    phone: match.phone ?? null,
    address: match.address1 ?? null,
  };
}

export type GoHighLevelSyncOutcome = {
  contactId: string;
  contactAction: "created" | "updated";
  noteId: string | null;
};

// Upserts the contact and attaches an AI Assistant note. Additive-only:
// empty fields are omitted so existing values are never cleared.
export async function syncGoHighLevelContactWithNote(
  credentials: GoHighLevelCredentials,
  fields: ContactFields,
  noteBody: string,
): Promise<GoHighLevelSyncOutcome> {
  const body: Record<string, string> = {
    locationId: credentials.locationId,
  };

  if (fields.email) body.email = fields.email;
  if (fields.phone) body.phone = fields.phone;
  if (fields.firstname) body.firstName = fields.firstname;
  if (fields.lastname) body.lastName = fields.lastname;
  if (fields.address) body.address1 = fields.address;

  const upserted = await ghlFetch(credentials, "/contacts/upsert", {
    method: "POST",
    body: JSON.stringify(body),
  });

  const contact = upserted.contact as { id?: string } | undefined;
  const contactId = contact?.id;

  if (!contactId) {
    throw new GoHighLevelError(
      "GoHighLevel did not return a contact id from upsert.",
      502,
    );
  }

  const contactAction: "created" | "updated" =
    upserted.new === true ? "created" : "updated";

  let noteId: string | null = null;

  try {
    const note = await ghlFetch(
      credentials,
      `/contacts/${encodeURIComponent(contactId)}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body: noteBody }),
      },
    );

    const noteRecord = note.note as { id?: string } | undefined;
    noteId = noteRecord?.id ?? null;
  } catch {
    // Contact write succeeded; a failed note is reported but not fatal.
    noteId = null;
  }

  return { contactId, contactAction, noteId };
}
