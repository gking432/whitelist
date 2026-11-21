import type { CapabilityKey } from "@/lib/packages/capabilities";

// Starter packages a partner can create with one click. These are ordinary
// partner_packages rows once created — the partner can rename, retoggle, or
// archive them. "Custom" is not a preset: custom packages are created per
// client during setup.

export type PackagePreset = {
  name: string;
  description: string;
  capabilities: CapabilityKey[];
};

export const PACKAGE_PRESETS: PackagePreset[] = [
  {
    name: "Basic Automation",
    description:
      "Northstar CRM, lead intake, external CRM sync, automation packs, review requests, and reports. No AI drafting or routing.",
    capabilities: [
      "northstar_crm",
      "lead_intake",
      "crm_sync",
      "automation_packs",
      "review_requests",
      "reports_portal",
    ],
  },
  {
    name: "AI Assist",
    description:
      "Everything in Basic Automation plus AI intake routing, AI message drafting, and approval-gated SMS sending.",
    capabilities: [
      "lead_intake",
      "northstar_crm",
      "crm_sync",
      "automation_packs",
      "review_requests",
      "reports_portal",
      "ai_intake_routing",
      "message_drafting",
      "approval_gated_sending",
      "quote_intelligence",
      "feedback_intelligence",
    ],
  },
  {
    name: "Full AI Operations",
    description:
      "The complete offer: everything in AI Assist plus website chat, appointment booking, and the AI voice features as they ship.",
    capabilities: [
      "lead_intake",
      "northstar_crm",
      "crm_sync",
      "automation_packs",
      "review_requests",
      "reports_portal",
      "ai_intake_routing",
      "message_drafting",
      "approval_gated_sending",
      "quote_intelligence",
      "feedback_intelligence",
      "website_ai_chat",
      "appointment_booking",
      "live_call_assistant",
      "live_scheduling_assistant",
      "ai_phone_answering",
    ],
  },
];

export function presetCapabilitiesMap(
  preset: PackagePreset,
): Record<string, boolean> {
  return Object.fromEntries(preset.capabilities.map((key) => [key, true]));
}
