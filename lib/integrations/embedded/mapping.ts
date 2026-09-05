import type { ZapierField } from "./zapier.ts";

export type FieldMapping = Record<
  string,
  { path: string } | { value: unknown }
>;
const FORBIDDEN = new Set(["__proto__", "prototype", "constructor"]);
export function readField(source: unknown, path: string): unknown {
  if (!path || path.length > 300) return undefined;
  let value: unknown = source;
  for (const part of path.split(".")) {
    if (
      FORBIDDEN.has(part) ||
      value === null ||
      typeof value !== "object" ||
      !Object.hasOwn(value, part)
    )
      return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
export function mapFields(source: unknown, mapping: FieldMapping) {
  const output: Record<string, unknown> = {};
  if (Object.keys(mapping).length > 100)
    throw new Error("Choose at most 100 fields.");
  for (const [key, rule] of Object.entries(mapping)) {
    if (FORBIDDEN.has(key) || !rule || typeof rule !== "object")
      throw new Error("Invalid field mapping.");
    const value = "path" in rule ? readField(source, rule.path) : rule.value;
    if (value !== undefined) output[key] = value;
  }
  return output;
}
export function fieldPaths(value: unknown, prefix = "", depth = 0): string[] {
  if (!value || typeof value !== "object" || depth > 5) return [];
  return Object.entries(value)
    .filter(([key]) => !FORBIDDEN.has(key))
    .slice(0, 100)
    .flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return [path, ...fieldPaths(child, path, depth + 1)];
    })
    .slice(0, 300);
}
export function validateFields(
  fields: ZapierField[],
  inputs: Record<string, unknown>,
) {
  for (const field of fields) {
    if (field.type !== "input_field" && field.type !== "fieldset")
      throw new Error(
        "This operation needs managed setup for its field format.",
      );
    if (field.type === "fieldset")
      throw new Error(
        "Grouped fields need managed setup before this operation can be enabled.",
      );
    const value = inputs[field.id];
    const missing = value === undefined || value === null || value === "";
    if (field.is_required && missing && field.format !== "READONLY")
      throw new Error(`Choose a value for ${field.title}.`);
    if (missing || field.format === "SELECT") continue;
    const type = field.value_type?.toUpperCase();
    if (
      (type === "NUMBER" &&
        (typeof value !== "number" || !Number.isFinite(value))) ||
      (type === "INTEGER" && !Number.isInteger(value)) ||
      (type === "ARRAY" && !Array.isArray(value)) ||
      (type === "OBJECT" &&
        (typeof value !== "object" || Array.isArray(value))) ||
      (type === "STRING" && typeof value !== "string")
    )
      throw new Error(`The value for ${field.title} has the wrong type.`);
    if (
      field.format === "FILE" &&
      (typeof value !== "string" || !value.startsWith("https://"))
    )
      throw new Error(`Choose an HTTPS file address for ${field.title}.`);
  }
  const ids = new Set(
    fields
      .filter((field) => field.format !== "READONLY")
      .map((field) => field.id),
  );
  if (Object.keys(inputs).some((id) => !ids.has(id)))
    throw new Error(
      "Some fields changed. Refresh the setup fields and test again.",
    );
}

export function validateInbound(
  required: string[],
  values: Record<string, unknown>,
) {
  const aliases: Record<string, string[]> = {
    "phone or email": ["phone", "email"],
    "appointment preference": ["appointment_preference", "appointment_time"],
    "source identifier": ["source_id", "source"],
    "customer or job identifier": ["customer_id", "job_id"],
    customer: ["customer", "name", "customer_id"],
  };
  for (const field of required)
    if (
      !(aliases[field] ?? [field]).some(
        (key) =>
          values[key] !== undefined &&
          values[key] !== null &&
          values[key] !== "",
      )
    )
      throw new Error(`Map a value for ${field}.`);
}
