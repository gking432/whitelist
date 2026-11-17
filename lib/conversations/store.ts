import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentScope } from "@/lib/agents/types";
import type {
  Conversation,
  ConversationMessage,
  ConversationSnapshot,
} from "./types";
import { collectActivatedGoogleInbox, suppressManagedWorkspaceIngress } from "../integrations/connectors/read-only-policy";

export async function conversationTeamEnabled(
  admin: SupabaseClient,
  scope: AgentScope,
) {
  const { data, error } = await admin
    .from("agent_team_settings")
    .select("conversations_enabled")
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw new Error("Conversation settings unavailable.");
  // Once connected, intake stays durable during team pauses; only execution pauses.
  return data?.conversations_enabled === true;
}
export async function ingestMessage(
  admin: SupabaseClient,
  input: AgentScope & {
    connectionId: string;
    channel: Conversation["channel"];
    thread: string;
    key: string;
    body: string;
    occurredAt?: string;
  },
) {
  const { data, error } = await admin.rpc("ingest_business_message", {
    p_partner: input.partnerId,
    p_client: input.clientId,
    p_connection: input.connectionId,
    p_channel: input.channel,
    p_thread: input.thread,
    p_key: input.key,
    p_body: input.body,
    p_occurred_at: input.occurredAt ?? new Date().toISOString(),
  });
  if (error)
    throw new Error(
      "The message could not be saved. Retry with the same message ID.",
    );
  return data as {
    id: string;
    duplicate: boolean;
    revision: number;
    workId?: string;
  };
}
export async function readConversations(
  admin: SupabaseClient,
  scope: AgentScope,
  canWrite: boolean,
  selectedId?: string,
): Promise<ConversationSnapshot> {
  const [rows, contacts, enabled] = await Promise.all([
    admin
      .from("business_conversations")
      .select("*")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("updated_at", { ascending: false })
      .limit(101),
    admin
      .from("crm_contacts")
      .select("id,first_name,last_name,email,phone")
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("updated_at", { ascending: false })
      .limit(200),
    conversationTeamEnabled(admin, scope),
  ]);
  if (rows.error || contacts.error)
    throw new Error("Conversations could not be loaded.");
  const conversations = (rows.data ?? []).slice(0, 100) as Conversation[];
  if (selectedId && !conversations.some((c) => c.id === selectedId)) {
    const { data, error } = await admin
      .from("business_conversations")
      .select("*")
      .eq("id", selectedId)
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .maybeSingle();
    if (error) throw new Error("Conversation could not be loaded.");
    if (data) conversations.push(data as Conversation);
  }
  const selected =
    conversations.find((c) => c.id === selectedId) ?? conversations[0];
  const [messages, events] = selected
    ? await Promise.all([
        admin
          .from("business_conversation_messages")
          .select("*")
          .eq("conversation_id", selected.id)
          .eq("partner_id", scope.partnerId)
          .eq("client_id", scope.clientId)
          .order("created_at", { ascending: false })
          .limit(100),
        admin
          .from("business_conversation_events")
          .select("id,detail,created_at")
          .eq("conversation_id", selected.id)
          .eq("partner_id", scope.partnerId)
          .eq("client_id", scope.clientId)
          .order("created_at", { ascending: false })
          .limit(20),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (messages.error || events.error)
    throw new Error("Conversation history could not be loaded.");
  return {
    conversations,
    messages: (messages.data ?? []).reverse() as ConversationMessage[],
    contacts: contacts.data ?? [],
    events: events.data ?? [],
    selectedId: selected?.id ?? null,
    canWrite,
    enabled,
    hasMore: (rows.data?.length ?? 0) > 100,
  };
}
// Authenticated provider ingress calls this AFTER signature checks, never on a
// visitor-supplied email address or forwarded-email body.
export async function adoptInboundConversation(
  admin: SupabaseClient,
  input: AgentScope & {
    connectionId: string | null;
    eventId: string;
    eventType: string;
    data: Record<string, unknown>;
  },
) {
  if (
    !input.connectionId ||
    !["sms.received", "email.received", "instagram.message"].includes(
      input.eventType,
    )
  )
    return false;
  const { data: connection, error: connectionError } = await admin
    .from("integration_connections")
    .select("config,status,runtime_mode,provider:integration_providers!inner(provider_key)")
    .eq("id", input.connectionId)
    .eq("partner_id", input.partnerId)
    .eq("client_id", input.clientId)
    .maybeSingle();
  if (connectionError || !connection)
    throw new Error("Conversation connection unavailable.");
  const teamEnabled = await conversationTeamEnabled(admin, input);
  const provider = connection.provider as unknown as { provider_key: string };
  // A delayed managed/imported message remains consumed during a pause. It
  // cannot fall through into generic automation or customer identity matching.
  if (suppressManagedWorkspaceIngress({ config: connection.config ?? {}, providerKey: provider.provider_key,
    status: connection.status, runtimeMode: connection.runtime_mode, eventType: input.eventType, teamEnabled })) return true;
  if (!teamEnabled && !collectActivatedGoogleInbox({ config: connection.config ?? {}, providerKey: provider.provider_key,
    status: connection.status, runtimeMode: connection.runtime_mode, eventType: input.eventType })) return false;
  const channel =
    input.eventType === "sms.received"
      ? "sms"
      : input.eventType === "email.received"
        ? "email"
        : "instagram";
  const thread = channel === "sms" ? input.data.phone : input.data.sender;
  const body = input.data.message;
  if (
    typeof thread !== "string" ||
    !thread.trim() ||
    typeof body !== "string" ||
    !body.trim()
  )
    throw new Error(
      "Incoming message is missing its authenticated sender or text.",
    );
  await ingestMessage(admin, {
    ...input,
    connectionId: input.connectionId,
    channel,
    thread: thread.trim(),
    key: input.eventId,
    body: body.slice(0, 6000),
    occurredAt:
      typeof input.data.occurred_at === "string"
        ? input.data.occurred_at
        : undefined,
  });
  return true;
}
