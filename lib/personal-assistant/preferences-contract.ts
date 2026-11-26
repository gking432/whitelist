import { z } from "zod";

export const PERSONAL_ASSISTANTS = ["muse", "chatgpt_dot", "grok", "other", "workstation"] as const;
export const PERSONAL_ASSISTANT_LABELS: Record<(typeof PERSONAL_ASSISTANTS)[number], string> = {
  muse: "Muse", chatgpt_dot: "ChatGPT Dot", grok: "Grok", other: "Another assistant", workstation: "Workstation assistant (ours)",
};
export const PersonalAssistantSettingsSchema = z.object({
  answer: z.enum(["unanswered", "yes", "no", "skipped"]),
  assistant: z.enum(PERSONAL_ASSISTANTS).nullable(),
}).strict().superRefine((value, context) => {
  const valid = value.answer === "yes" ? value.assistant !== null && value.assistant !== "workstation"
    : value.answer === "no" ? value.assistant === null || value.assistant === "workstation"
      : value.assistant === null;
  if (!valid) context.addIssue({ code: "custom", message: "Choose an assistant for Yes, or save No or Skip without an external assistant." });
});
export type PersonalAssistantSettings = z.infer<typeof PersonalAssistantSettingsSchema>;
// Validate the complete object before separating its revision from its settings.
export const SavedPersonalAssistantPreferencesSchema = z.object({
  answer: z.enum(["unanswered", "yes", "no", "skipped"]), assistant: z.enum(PERSONAL_ASSISTANTS).nullable(),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
}).strict().superRefine((value, context) => {
  if (!PersonalAssistantSettingsSchema.safeParse({ answer: value.answer, assistant: value.assistant }).success)
    context.addIssue({ code: "custom", message: "Invalid saved assistant preference." });
});
export type PersonalAssistantPreferences = z.infer<typeof SavedPersonalAssistantPreferencesSchema>;
export const PersonalAssistantSaveSchema = z.object({
  key: z.uuid(), revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1), settings: PersonalAssistantSettingsSchema,
}).strict();
export type PersonalAssistantSave = z.infer<typeof PersonalAssistantSaveSchema>;
/** A render-time mismatch guard, never an authorization credential. */
export const PersonalAssistantScopeKeySchema = z.string().max(73).refine(value => {
  const parts = value.split(":"); return parts.length === 2 && parts.every(part => z.uuid().safeParse(part).success);
});

export function personalAssistantConnection(preferences: PersonalAssistantSettings) {
  const selected = preferences.assistant;
  if (!selected) return {
    state: "not_selected" as const, label: "Personal assistant", detail: preferences.answer === "skipped"
      ? "Skipped for now. You can change this private preference at any time."
      : preferences.answer === "no" ? "No personal assistant selected. You can choose our workstation assistant later."
        : "Optional setup. Choose the personal assistant you prefer.", canChat: false as const,
  };
  if (selected === "workstation") return { state: "setup_needed" as const, label: PERSONAL_ASSISTANT_LABELS[selected],
    detail: "Preference saved. Our text assistant needs separate setup; conversations are not available yet.", canChat: false as const };
  return { state: "unavailable" as const, label: PERSONAL_ASSISTANT_LABELS[selected],
    detail: "Preference saved. A connection to your personal assistant is not available in this workstation yet.", canChat: false as const };
}
export const PersonalAssistantStoredSnapshotSchema = z.object({
  preferences: SavedPersonalAssistantPreferencesSchema, available: z.literal(true), canEdit: z.literal(true),
}).strict();
export const PersonalAssistantSnapshotSchema = PersonalAssistantStoredSnapshotSchema.extend({
  version: z.literal(1), connection: z.object({
    state: z.enum(["not_selected", "setup_needed", "unavailable"]), label: z.string().min(1).max(100),
    detail: z.string().min(1).max(400), canChat: z.literal(false),
  }).strict(),
}).superRefine((snapshot, context) => {
  const expected = personalAssistantConnection(snapshot.preferences);
  if (snapshot.connection.state !== expected.state || snapshot.connection.label !== expected.label || snapshot.connection.detail !== expected.detail || snapshot.connection.canChat !== expected.canChat)
    context.addIssue({ code: "custom", message: "The saved preference does not establish a verified connection." });
});
export type PersonalAssistantSnapshot = z.infer<typeof PersonalAssistantSnapshotSchema>;
export function personalAssistantSnapshot(stored: unknown): PersonalAssistantSnapshot {
  const value = PersonalAssistantStoredSnapshotSchema.parse(stored);
  return { ...value, version: 1, connection: personalAssistantConnection(value.preferences) };
}
