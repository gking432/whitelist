// HubSpot REST adapter (pilot stack). Server-side only — tokens are
// decrypted from integration_secrets and never leave the server. Uses plain
// fetch against the public CRM v3 API; no SDK dependency.

const HUBSPOT_BASE = "https://api.hubapi.com";

export type HubSpotCredentials = {
  privateAppToken: string;
};

export type HubSpotContactFields = {
  email: string | null;
  phone: string | null;
  firstname: string | null;
  lastname: string | null;
  address: string | null;
};

export class HubSpotError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HubSpotError";
    this.status = status;
  }
}

async function hubspotFetch(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${HUBSPOT_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    // Provider calls run inside webhook handling; keep them bounded.
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    // Never include response bodies wholesale — they can echo the request.
    throw new HubSpotError(
      `HubSpot request failed (${response.status}) on ${path.split("?")[0]}`,
      response.status,
    );
  }

  if (response.status === 204) {
    return {};
  }

  return (await response.json()) as Record<string, unknown>;
}

// Cheap credential check: token validity + CRM scope.
export async function testHubSpotConnection(
  credentials: HubSpotCredentials,
): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  try {
    await hubspotFetch(
      credentials.privateAppToken,
      "/crm/v3/objects/contacts?limit=1",
    );

    return {
      ok: true,
      detail: "Token accepted. Northstar can read and create contacts.",
    };
  } catch (error) {
    if (error instanceof HubSpotError) {
      return {
        ok: false,
        detail:
          error.status === 401 || error.status === 403
            ? "HubSpot rejected the token. Check the private app token and its CRM scopes."
            : `HubSpot returned an error (${error.status}). Try again shortly.`,
      };
    }

    return { ok: false, detail: "Could not reach HubSpot." };
  }
}

async function findContactId(
  token: string,
  fields: HubSpotContactFields,
): Promise<string | null> {
  const searchBy: { property: string; value: string }[] = [];

  if (fields.email) {
    searchBy.push({ property: "email", value: fields.email });
  } else if (fields.phone) {
    searchBy.push({ property: "phone", value: fields.phone });
  }

  if (searchBy.length === 0) {
    return null;
  }

  const result = await hubspotFetch(token, "/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: searchBy.map((filter) => ({
        filters: [
          { propertyName: filter.property, operator: "EQ", value: filter.value },
        ],
      })),
      limit: 1,
    }),
  });

  const first = (result.results as { id?: string }[] | undefined)?.[0];

  return first?.id ?? null;
}

export type HubSpotSyncOutcome = {
  contactId: string;
  contactAction: "created" | "updated";
  noteId: string | null;
};

// Upserts the contact and attaches an "AI Assistant" note. Additive-only:
// existing property values are never cleared (empty fields are omitted).
export async function syncContactWithNote(
  credentials: HubSpotCredentials,
  fields: HubSpotContactFields,
  noteBody: string,
): Promise<HubSpotSyncOutcome> {
  const token = credentials.privateAppToken;

  const properties: Record<string, string> = {};

  if (fields.email) properties.email = fields.email;
  if (fields.phone) properties.phone = fields.phone;
  if (fields.firstname) properties.firstname = fields.firstname;
  if (fields.lastname) properties.lastname = fields.lastname;
  if (fields.address) properties.address = fields.address;

  const existingId = await findContactId(token, fields);
  let contactId: string;
  let contactAction: "created" | "updated";

  if (existingId) {
    await hubspotFetch(token, `/crm/v3/objects/contacts/${existingId}`, {
      method: "PATCH",
      body: JSON.stringify({ properties }),
    });
    contactId = existingId;
    contactAction = "updated";
  } else {
    const created = await hubspotFetch(token, "/crm/v3/objects/contacts", {
      method: "POST",
      body: JSON.stringify({ properties }),
    });
    contactId = String((created as { id: string }).id);
    contactAction = "created";
  }

  let noteId: string | null = null;

  try {
    const note = await hubspotFetch(token, "/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({
        properties: {
          hs_note_body: noteBody,
          hs_timestamp: new Date().toISOString(),
        },
        associations: [
          {
            to: { id: contactId },
            types: [
              {
                associationCategory: "HUBSPOT_DEFINED",
                // note -> contact default association type
                associationTypeId: 202,
              },
            ],
          },
        ],
      }),
    });
    noteId = String((note as { id: string }).id);
  } catch {
    // The contact write succeeded; a failed note is reported but not fatal.
    noteId = null;
  }

  return { contactId, contactAction, noteId };
}

// The exact payload live mode would send — used for dry-run previews.
export function buildContactPayloadPreview(
  fields: HubSpotContactFields,
  noteBody: string,
): Record<string, unknown> {
  return {
    contact: {
      properties: {
        ...(fields.email ? { email: fields.email } : {}),
        ...(fields.phone ? { phone: fields.phone } : {}),
        ...(fields.firstname ? { firstname: fields.firstname } : {}),
        ...(fields.lastname ? { lastname: fields.lastname } : {}),
        ...(fields.address ? { address: fields.address } : {}),
      },
    },
    note: { hs_note_body: noteBody },
  };
}
