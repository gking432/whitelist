import { CAPABILITY_KEYS } from "@/lib/packages/capabilities";

// Shared FormData reader for the package builder forms (partner-level and
// custom-per-client). Toggles arrive as cap_<key> checkboxes.
export function readPackageFields(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const capabilities: Record<string, boolean> = {};

  for (const key of CAPABILITY_KEYS) {
    if (formData.get(`cap_${key}`) === "on") {
      capabilities[key] = true;
    }
  }

  return { name, description, capabilities };
}
