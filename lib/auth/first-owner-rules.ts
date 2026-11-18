export type FirstOwnerBusiness = { name: string; description: string; timezone: string };
export type FirstOwnerRequest = { key: string; business: FirstOwnerBusiness };
export class FirstOwnerValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super("Check your business details and try again."); this.fields = fields;
  }
}
export const firstOwnerUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export function parseFirstOwnerRequest(value: unknown): FirstOwnerRequest {
  const request = object(value), business = object(request?.business), fields: Record<string, string> = {};
  if (!request || Object.keys(request).some((key) => !["key", "business"].includes(key)) || !firstOwnerUuid(request.key)) fields.key = "Refresh this page to start a new business request.";
  if (!business || Object.keys(business).some((key) => !["name", "description", "timezone"].includes(key))) fields.name = "Enter your business details.";
  const clean = (key: string) => typeof business?.[key] === "string" ? business[key].trim() : "";
  const name = clean("name"), description = clean("description"), timezone = clean("timezone");
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) fields.name = "Enter a business name between 2 and 100 characters.";
  if (description.length < 10 || description.length > 2000 || /[\u0000\u007f]/.test(description)) fields.description = "Describe your business in 10 to 2,000 characters.";
  try { if (!timezone || timezone.length > 100) throw new Error(); new Intl.DateTimeFormat("en", { timeZone: timezone }).format(); }
  catch { fields.timezone = "Choose a valid timezone, such as America/Chicago."; }
  if (Object.keys(fields).length) throw new FirstOwnerValidationError(fields);
  return { key: request!.key as string, business: { name, description, timezone } };
}

export function firstOwnerSameOrigin(origin: string | null, appUrl: string): boolean {
  try { return origin !== null && origin === new URL(appUrl).origin; } catch { return false; }
}
