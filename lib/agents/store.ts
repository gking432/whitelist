import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentScope, WorkItem, WorkStatus } from "./types";
import type { WorkKind } from "./catalog";
import { authorityChannel, readEffectiveAuthority } from "./authority";

export type DelegatedWork = {
  kind: WorkKind;
  title: string;
  key: string;
  input?: Record<string, unknown>;
  leadId?: string;
  recordId?: string;
};
export async function delegateWork(
  admin: SupabaseClient,
  work: WorkItem,
  children: DelegatedWork[],
  summary: string,
  result: Record<string, unknown> = {},
) {
  for (const child of children) {
    const channel = authorityChannel(child.input?.channel);
    if (!channel) continue;
    const authority = await readEffectiveAuthority(admin, {
      partnerId: work.partner_id, clientId: work.client_id,
    }, channel, {
      phase: "draft",
      expectedRevision: typeof child.input?.authority_revision === "number" ? child.input.authority_revision : undefined,
    });
    if (!authority.allowed) throw new Error(authority.reason);
  }
  const { data, error } = await admin.rpc("delegate_agent_work", {
    p_work: work.id,
    p_claim: work.claim_token,
    p_children: children.map((c) => ({ ...c, title: c.title.slice(0, 180) })),
    p_summary: summary,
    p_result: result,
  });
  if (error || !data)
    throw new Error(
      "Delegation could not be saved. The assignment may have been stopped or changed.",
    );
}

export async function assignWork(
  admin: SupabaseClient,
  scope: AgentScope,
  args: {
    kind: WorkKind;
    title: string;
    key: string;
    input?: Record<string, unknown>;
    parentId?: string;
    leadId?: string;
    recordId?: string;
  },
) {
  const channel = authorityChannel(args.input?.channel);
  if (channel) {
    const authority = await readEffectiveAuthority(admin, scope, channel, {
      phase: "draft",
      expectedRevision: typeof args.input?.authority_revision === "number" ? args.input.authority_revision : undefined,
    });
    if (!authority.allowed) throw new Error(authority.reason);
    args = { ...args, input: { ...args.input, authority_revision: authority.revision } };
  }
  const { data, error } = await admin.rpc("create_agent_work", {
    p_partner: scope.partnerId,
    p_client: scope.clientId,
    p_kind: args.kind,
    p_title: args.title.slice(0, 180),
    p_key: args.key,
    p_input: args.input ?? {},
    p_parent: args.parentId ?? null,
    p_lead: args.leadId ?? null,
    p_record: args.recordId ?? null,
  });
  if (error || typeof data !== "string")
    throw new Error("The agent assignment could not be saved.");
  return data;
}
export async function finishWork(
  admin: SupabaseClient,
  work: WorkItem,
  status: WorkStatus,
  summary: string,
  result: Record<string, unknown> = {},
  delay = 60,
) {
  const { data, error } = await admin.rpc("finish_agent_work", {
    p_id: work.id,
    p_claim: work.claim_token,
    p_status: status,
    p_summary: summary,
    p_result: result,
    p_delay: delay,
  });
  if (error || !data)
    throw new Error(
      "The assignment changed or its lease expired; its result was not overwritten.",
    );
}
export async function checkFollowup(
  admin: SupabaseClient,
  workId: string,
): Promise<{ allowed: boolean; reason: string }> {
  const { data, error } = await admin.rpc("agent_followup_check", {
    p_work: workId,
  });
  if (error || !data || typeof data.allowed !== "boolean")
    throw new Error("Customer eligibility could not be verified.");
  return data;
}
