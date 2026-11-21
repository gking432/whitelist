export type Conversation = {
  id: string;
  partner_id: string;
  client_id: string;
  connection_id: string;
  channel: "website_chat" | "sms" | "email" | "instagram";
  external_thread_id: string;
  contact_id: string;
  lead_id: string | null;
  identity_status: "unverified" | "owner_verified";
  mode: "agent" | "human";
  state: "open" | "waiting_approval" | "needs_attention" | "closed";
  agent_key: string;
  summary: string;
  next_action: string;
  opted_out: boolean;
  revision: number;
  updated_at: string;
};
export type ConversationMessage = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  body: string;
  status: string;
  approval_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
export type ConversationSnapshot = {
  conversations: Conversation[];
  messages: ConversationMessage[];
  contacts: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
  }[];
  events: { id: string; detail: string; created_at: string }[];
  selectedId: string | null;
  canWrite: boolean;
  enabled: boolean;
  hasMore: boolean;
};
