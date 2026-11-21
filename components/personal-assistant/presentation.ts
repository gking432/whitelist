import { PERSONAL_ASSISTANT_LABELS, type PersonalAssistantSettings, type PersonalAssistantSnapshot } from "../../lib/personal-assistant/preferences-contract.ts";

export function assistantPreferenceSummary(settings: PersonalAssistantSettings): string {
  if (settings.answer === "skipped") return "Skipped for now";
  if (settings.answer === "unanswered") return "Not selected";
  if (settings.assistant === "workstation") return PERSONAL_ASSISTANT_LABELS.workstation;
  if (settings.answer === "no") return "No personal assistant selected";
  return settings.assistant ? PERSONAL_ASSISTANT_LABELS[settings.assistant] : "Choose your assistant";
}
export function assistantStatusLabel(state: PersonalAssistantSnapshot["connection"]["state"]): string {
  return state === "setup_needed" ? "Setup needed" : state === "unavailable" ? "Integration unavailable" : "Not selected";
}
