// Owner commands share one table; the manager conversation shows only its own kinds.
export const MANAGER_CHAT_COMMANDS = ["manager_control", "review_context", "set_authority"] as const;

const channelLabels: Record<string, string> = { website: "website chat", email: "email", sms: "text message", instagram: "Instagram", calendar: "calendar" };
const modeLabels: Record<string, string> = { off: "off", observe: "watch only", draft: "draft only", require_approval: "ask me first" };

export function managerCommandLabel(command: Record<string, unknown> | null | undefined) {
  const action = command?.action;
  if (action === "manager_control") return String(command?.command ?? "Manager instruction");
  if (action === "review_context") return "Review business context";
  if (action === "set_authority" && typeof command?.channel === "string" && typeof command?.mode === "string")
    return `Set ${channelLabels[command.channel] ?? command.channel} authority to ${modeLabels[command.mode] ?? command.mode}`;
  return "Owner instruction";
}
