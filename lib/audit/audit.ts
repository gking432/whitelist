import type { AccessContext } from "@/lib/permissions/types";
import { redactAuditValue } from "@/lib/audit/redact";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type AuditEventInput = {
  actor: AccessContext;
  action: string;
  targetType: string;
  targetId?: string | null;
  summary?: string;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

export async function recordAuditEvent(input: AuditEventInput) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured for audit logging.");
  }

  const { error } = await supabase.from("audit_events").insert({
    actor_user_id: input.actor.userId,
    actor_role: input.actor.role,
    partner_id: input.actor.partnerId ?? null,
    client_id: input.actor.clientId ?? null,
    action: input.action,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    summary: input.summary ?? null,
    before_snapshot:
      input.beforeSnapshot === undefined
        ? null
        : redactAuditValue(input.beforeSnapshot),
    after_snapshot:
      input.afterSnapshot === undefined
        ? null
        : redactAuditValue(input.afterSnapshot),
    metadata: redactAuditValue(input.metadata ?? {}),
    ip_address: input.ipAddress ?? null,
    user_agent: input.userAgent ?? null,
  });

  if (error) {
    throw new Error(`Failed to record audit event: ${error.message}`);
  }
}
