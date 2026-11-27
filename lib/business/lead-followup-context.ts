import type { SupabaseClient } from "@supabase/supabase-js";
import type { DailyBriefData } from "./daily-brief.ts";
import { isLeadFollowUp, leadFollowUpContext } from "./lead-followups.ts";
import { loadDeliveryAccount } from "../delivery/channel-selection.ts";
import { readEffectiveAuthority } from "../agents/authority.ts";

type Approval = DailyBriefData["approvals"][number];
type Scope = { partnerId: string; clientId: string };

const day = (value: string | null, timeZone: string) => {
  const at = Date.parse(value ?? "");
  return Number.isFinite(at)
    ? new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(at))
    : null;
};

/**
 * Follow-up drafts are written from a CRM lead the owner never has to open.
 * Attach that lead's essentials so the decision card can say why this person
 * and what they asked for. Read-only; nothing here changes the approval.
 */
export async function withLeadFollowUpContext(
  admin: SupabaseClient,
  scope: Scope,
  approvals: Approval[],
  timeZone: string,
): Promise<Approval[]> {
  const ids = approvals.filter(isLeadFollowUp).map((item) => item.id);
  if (!ids.length) return approvals;
  const drafts = await admin.from("crm_communications")
    .select("approval_id,lead_id,contact_id")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId)
    .in("approval_id", ids);
  if (drafts.error || !drafts.data?.length) return approvals;
  const leadIds = [...new Set(drafts.data.map((row) => row.lead_id).filter((id): id is string => !!id))];
  const contactIds = [...new Set(drafts.data.map((row) => row.contact_id).filter((id): id is string => !!id))];
  const [leads, contacts] = await Promise.all([
    leadIds.length ? admin.from("crm_leads")
      .select("id,title,summary,description,status,last_contact_at,created_at,service_type")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("id", leadIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length ? admin.from("crm_contacts")
      .select("id,first_name,last_name,company_name")
      .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).in("id", contactIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (leads.error || contacts.error) return approvals;
  return approvals.map((approval) => {
    const draft = drafts.data.find((row) => row.approval_id === approval.id);
    if (!draft) return approval;
    const lead = (leads.data ?? []).find((row) => row.id === draft.lead_id);
    const contact = (contacts.data ?? []).find((row) => row.id === draft.contact_id);
    const name = [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || contact?.company_name || null;
    const lastContact = lead?.last_contact_at ?? lead?.created_at ?? null;
    const since = day(lastContact, timeZone);
    return {
      ...approval,
      proposed_payload: {
        ...approval.proposed_payload,
        lead_context: {
          name,
          stage: lead?.status ?? null,
          last_contact_at: lastContact,
          reason: since ? `Open lead with no reply or follow-up since ${since}.` : "Open lead with no recent contact.",
          history: [lead?.title, lead?.summary ?? lead?.description].filter(Boolean).join(" — ") || null,
        },
      },
    };
  });
}

/**
 * Before the owner approves drafted outreach, say whether it can be delivered.
 * Uses the delivery account selection and execute-phase authority that the
 * send itself runs, so the pane never invites an approval that will be skipped.
 */
export async function outboundReadiness(
  admin: SupabaseClient,
  scope: Scope,
  approvals: Approval[],
): Promise<DailyBriefData["outbound"]> {
  const channels = [...new Set(approvals.filter(isLeadFollowUp).map((item) => leadFollowUpContext(item).channel))];
  const result: NonNullable<DailyBriefData["outbound"]> = {};
  for (const channel of channels) {
    const account = await loadDeliveryAccount(admin, { ...scope, channel });
    if (!account.connection) {
      result[channel] = { ready: false, reason: channel === "email"
        ? "No business email account is connected for sending yet. Connect one in Apps and these drafts will be ready to go."
        : "No texting number is connected yet. Connect one in Apps and these drafts will be ready to go." };
      continue;
    }
    try {
      const authority = await readEffectiveAuthority(admin, scope, channel, { phase: "execute", approved: true, connectionId: account.connection.id });
      result[channel] = authority.allowed
        ? { ready: true, reason: "Ready to send from your connected account." }
        : { ready: false, reason: `${authority.reason} Review what agents may send in Agents.` };
    } catch {
      result[channel] = { ready: false, reason: "Sending permission could not be checked right now. Nothing will be sent until it is." };
    }
  }
  return result;
}
