import {
  V1_AUTOMATION_PACKS,
  type AutomationPack,
} from "./catalog.ts";
import {
  enabledCapabilityKeys,
  type CapabilityKey,
} from "../packages/capabilities.ts";

const PACK_CAPABILITIES: Record<string, CapabilityKey[]> = {
  "universal-lead-capture": [
    "lead_intake",
    "ai_intake_routing",
    "website_ai_chat",
  ],
  "speed-to-lead": [
    "ai_intake_routing",
    "message_drafting",
    "approval_gated_sending",
  ],
  "missed-call-rescue": [
    "ai_phone_answering",
    "live_call_assistant",
    "live_scheduling_assistant",
  ],
  "ai-phone-answering": ["ai_phone_answering"],
  "live-call-assistant": [
    "live_call_assistant",
    "live_scheduling_assistant",
  ],
  "booking-confirmations": [
    "appointment_booking",
    "live_scheduling_assistant",
  ],
};

export function automationPacksForPackage(
  capabilities: Record<string, unknown> | null | undefined,
): AutomationPack[] {
  const enabled = new Set(enabledCapabilityKeys(capabilities));

  return V1_AUTOMATION_PACKS.filter((pack) =>
    (PACK_CAPABILITIES[pack.key] ?? []).some((key) => enabled.has(key)),
  );
}
