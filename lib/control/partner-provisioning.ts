export type NewPartnerFields = {
  agencyName: string;
  ownerName: string;
  ownerEmail: string;
};

export function partnerSlugBase(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || "partner";
}

export function validateNewPartnerFields(
  fields: NewPartnerFields,
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!fields.agencyName) errors.agency_name = "Agency name is required.";
  if (!fields.ownerName) errors.owner_name = "Owner name is required.";
  if (!fields.ownerEmail) {
    errors.owner_email = "Owner email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.ownerEmail)) {
    errors.owner_email = "Enter a valid owner email.";
  }

  return errors;
}
