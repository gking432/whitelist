import { normalizePhone } from "../phone/normalize.ts";

export type CanonicalCallerRow = {
  object_type: string;
  external_object_id: string;
  native_object_id: string | null;
  canonical_data: Record<string, unknown> | null;
};

export type CanonicalCallerMatch = {
  match: {
    id: string;
    firstname: string | null;
    lastname: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
  };
  objectType: "customer" | "lead";
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function findCanonicalCallerMatch(
  records: CanonicalCallerRow[],
  phone: string,
): CanonicalCallerMatch | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const record = records.find(
    (candidate) =>
      normalizePhone(text(candidate.canonical_data?.phone)) === normalized,
  );
  if (!record) return null;

  const data = record.canonical_data ?? {};
  const fullName = text(data.name);
  const [derivedFirst, ...derivedLast] = (fullName ?? "").split(/\s+/);

  return {
    objectType: record.object_type === "lead" ? "lead" : "customer",
    match: {
      id: record.external_object_id,
      firstname: text(data.first_name) ?? derivedFirst ?? null,
      lastname: text(data.last_name) ?? (derivedLast.join(" ") || null),
      phone: text(data.phone),
      email: text(data.email),
      address: text(data.address),
    },
  };
}
