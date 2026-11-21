import type { Conversation } from "./types.ts";

export const MESSAGE_FILTERS = [
  { value: "all", label: "All" },
  { value: "needs_me", label: "Needs me" },
  { value: "handling", label: "Being handled" },
  { value: "closed", label: "Done" },
] as const;
export type MessageFilter = (typeof MESSAGE_FILTERS)[number]["value"];
export function matchesMessageFilter(
  conversation: Conversation,
  filter: MessageFilter,
) {
  if (filter === "all") return true;
  if (filter === "closed") return conversation.state === "closed";
  if (conversation.state === "closed") return false;
  if (filter === "needs_me")
    return (
      conversation.mode === "human" ||
      ["needs_attention", "waiting_approval"].includes(conversation.state)
    );
  return (
    conversation.mode === "agent" &&
    conversation.state === "open" &&
    !conversation.opted_out
  );
}
export const CHANNEL_NAMES: Record<Conversation["channel"], string> = {
  website_chat: "Website",
  sms: "Text",
  email: "Email",
  instagram: "Instagram",
};
