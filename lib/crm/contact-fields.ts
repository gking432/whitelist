// Normalized contact fields — the field-mapping contract every CRM adapter
// consumes. Northstar's intake events carry these keys; each adapter maps
// them to its provider's property names (see docs/16 for the matrix).

export type ContactFields = {
  email: string | null;
  phone: string | null;
  firstname: string | null;
  lastname: string | null;
  address: string | null;
};

// Default mapping from Northstar's normalized fields to provider fields.
// Documentation of record for docs/16; adapters implement these mappings.
export const DEFAULT_FIELD_MAPPINGS: Record<
  string,
  Record<keyof ContactFields, string>
> = {
  hubspot: {
    email: "email",
    phone: "phone",
    firstname: "firstname",
    lastname: "lastname",
    address: "address",
  },
  gohighlevel: {
    email: "email",
    phone: "phone",
    firstname: "firstName",
    lastname: "lastName",
    address: "address1",
  },
  outbound_webhook: {
    email: "contact.email",
    phone: "contact.phone",
    firstname: "contact.first_name",
    lastname: "contact.last_name",
    address: "contact.address",
  },
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractContactFields(
  data: Record<string, unknown>,
): ContactFields {
  const fullName = asString(data.name) || asString(data.full_name);
  const [firstname, ...rest] = fullName.split(/\s+/).filter(Boolean);

  return {
    email: asString(data.email) || null,
    phone: asString(data.phone) || null,
    firstname: firstname || null,
    lastname: rest.length > 0 ? rest.join(" ") : null,
    address: asString(data.address) || null,
  };
}
