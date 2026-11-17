import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalRecord } from "../connectors/types";
import { inboxInquiry } from "../providers/inbox-message";
import { enqueueInboundEvent } from "./queue";

export async function enqueueWorkspaceInquiry(
  admin: SupabaseClient,
  input: {
    partnerId: string;
    clientId: string;
    connectionId: string;
    providerKey: string;
    config: Record<string, unknown>;
    runtimeMode: string;
    record: CanonicalRecord;
  },
) {
  if (!["google_workspace", "microsoft_365"].includes(input.providerKey))
    return null;
  const inquiry = inboxInquiry(input.record, input.config, input.runtimeMode, Date.now(), input.providerKey);
  if (!inquiry) return null;
  return enqueueInboundEvent(admin, {
    partnerId: input.partnerId,
    clientId: input.clientId,
    connectionId: input.connectionId,
    eventType: "email.received",
    idempotencyKey: `inbox-${createHash("sha256").update(input.record.externalId).digest("hex")}`,
    data: inquiry,
  });
}
