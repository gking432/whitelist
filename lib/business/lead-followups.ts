import type { DailyBriefData } from "./daily-brief.ts";

type Approval = DailyBriefData["approvals"][number];

/** What the owner needs to judge one drafted follow-up without opening the CRM. */
export type LeadFollowUpContext = {
  name: string;
  to: string | null;
  channel: "email" | "sms";
  subject: string | null;
  /** Why the agent picked this lead, in one line. */
  reason: string | null;
  /** What the lead originally asked for or the last known state. */
  history: string | null;
  stage: string | null;
  lastContactAt: string | null;
};

/**
 * A background sales follow-up: a customer message prepared by an agent
 * assignment for a lead, outside any live conversation. Conversation replies
 * carry a conversation id and stay in their own thread.
 */
export function isLeadFollowUp(approval: Approval): boolean {
  const payload = approval.proposed_payload;
  return approval.type === "customer_message" &&
    !!payload &&
    typeof payload.agent_work_id === "string" &&
    !payload.conversation_id;
}

export function splitLeadFollowUps(approvals: readonly Approval[]) {
  const followUps: Approval[] = [];
  const other: Approval[] = [];
  for (const approval of approvals) (isLeadFollowUp(approval) ? followUps : other).push(approval);
  return { followUps, other };
}

const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export function leadFollowUpContext(approval: Approval): LeadFollowUpContext {
  const payload = approval.proposed_payload ?? {};
  const lead = payload.lead_context && typeof payload.lead_context === "object"
    ? payload.lead_context as Record<string, unknown> : {};
  const to = text(payload.to);
  const name = text(lead.name) ?? text(payload.customer_name) ??
    (approval.title.replace(/^Follow up:\s*/i, "").trim() || to || "Lead");
  return {
    name,
    to,
    channel: payload.channel === "sms" ? "sms" : "email",
    subject: text(payload.subject),
    reason: text(lead.reason),
    history: text(lead.history) ?? text(payload.customer_history),
    stage: text(lead.stage),
    lastContactAt: text(lead.last_contact_at),
  };
}

/** "Quiet for 41 days" style wording; null when the date is unknown. */
export function quietFor(lastContactAt: string | null, now: string): string | null {
  const then = Date.parse(lastContactAt ?? ""), clock = Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(clock) || then > clock) return null;
  const days = Math.floor((clock - then) / 86_400_000);
  if (days < 1) return "Last contact today";
  if (days < 14) return `Quiet for ${days} day${days === 1 ? "" : "s"}`;
  if (days < 90) return `Quiet for ${Math.round(days / 7)} weeks`;
  return `Quiet for ${Math.round(days / 30)} months`;
}
