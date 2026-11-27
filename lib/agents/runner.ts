import { readEffectiveAuthority } from "./authority";
import { departmentOutput } from "./departments";
import {
  respondToConversation,
  reviewConversations,
} from "@/lib/conversations/agent";
import { processBookingRequest } from "@/lib/conversations/booking";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isManagerControlIntent } from "../business/context-commands";
import { z } from "zod";
import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import {
  buildKnowledgeBlock,
  getKnowledgeProfile,
} from "@/lib/knowledge/profile";
import { reorderQuantity } from "@/lib/business/rules";
import type { BusinessRecord } from "@/lib/business/types";
import { readManagerBusinessContext } from "./manager-context";
import { processIntakeBookingRequest } from "./inquiry-progression";
import { AGENTS, WORK_LABELS, type WorkKind } from "./catalog";
import {
  assignWork,
  checkFollowup,
  finishWork,
  delegateWork,
  type DelegatedWork,
} from "./store";
import {
  childWorkState,
  deliveryWorkState,
  leadIsStale,
  purchaseWorkState,
} from "./rules";
import type { AgentScope, TeamSettings, WorkItem, WorkStatus } from "./types";

const DraftSchema = z.object({
  subject: z.string().max(200),
  body: z.string().min(1).max(5000),
});
const PlanSchema = z.object({
  explanation: z.string().max(2000),
  actions: z
    .array(
      z.enum([
        "marketing_campaign",
        "administration_review",
        "conversation_review",
        "sales_review",
        "operations_review",
        "owner_briefing",
      ]),
    )
    .max(6),
  unsupported: z.string().max(2000),
});
type Lead = {
  id: string;
  contact_id: string;
  title: string | null;
  status: string;
  summary: string | null;
  description: string | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
  last_contact_at: string | null;
};
type Contact = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  preferred_channel: string | null;
  updated_at: string;
};

async function settingsFor(
  admin: SupabaseClient,
  scope: AgentScope,
): Promise<TeamSettings> {
  const { data, error } = await admin
    .from("agent_team_settings")
    .select("*")
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .single();
  if (error || !data) throw new Error("Team settings are unavailable.");
  return data;
}
async function trackChildren(admin: SupabaseClient, work: WorkItem) {
  const ids = Array.isArray(work.result.child_ids)
    ? work.result.child_ids.filter((v): v is string => typeof v === "string")
    : [];
  if (!ids.length) return false;
  const { data, error } = await admin
    .from("agent_work_items")
    .select("id,status")
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .in("id", ids);
  if (error || data?.length !== ids.length)
    throw new Error("Delegated work could not be verified.");
  const state = childWorkState(data.map((r) => r.status as WorkStatus));
  await finishWork(admin, work, state.status, state.summary, work.result);
  return true;
}
async function leadContext(
  admin: SupabaseClient,
  scope: AgentScope,
  id: string,
) {
  const leadResult = await admin
    .from("crm_leads")
    .select(
      "id,contact_id,title,status,summary,description,next_action,created_at,updated_at,last_contact_at",
    )
    .eq("id", id)
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .single();
  if (leadResult.error || !leadResult.data)
    throw new Error("Lead is unavailable.");
  const lead = leadResult.data as Lead;
  const [customer, messages] = await Promise.all([
    admin
      .from("crm_contacts")
      .select(
        "id,first_name,last_name,email,phone,preferred_channel,updated_at",
      )
      .eq("id", lead.contact_id)
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .single(),
    admin
      .from("crm_communications")
      .select("direction,body,occurred_at,status")
      .eq("contact_id", lead.contact_id)
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .order("occurred_at", { ascending: false })
      .limit(10),
  ]);
  if (customer.error || !customer.data || messages.error)
    throw new Error("Customer context is unavailable.");
  return {
    lead,
    contact: customer.data as Contact,
    messages: messages.data ?? [],
  };
}
async function reviewSales(
  admin: SupabaseClient,
  work: WorkItem,
  settings: TeamSettings,
) {
  const scope = { partnerId: work.partner_id, clientId: work.client_id };
  const { data, error } = await admin.rpc("agent_sales_candidates", {
    p_partner: work.partner_id,
    p_client: work.client_id,
    p_hours: settings.lead_stale_hours,
    p_limit: 20,
  });
  if (error) throw new Error("Sales records could not be checked.");
  const children: DelegatedWork[] = [];
  for (const candidate of data ?? []) {
    if (children.length >= 20) break;
    const context = await leadContext(admin, scope, candidate.id);
    if (
      !leadIsStale(
        context.lead,
        settings.lead_stale_hours,
        Date.now(),
        context.messages[0]?.occurred_at,
      )
    )
      continue;
    if (!context.contact.email && !context.contact.phone) continue;
    const channel = context.contact.preferred_channel === "sms" && context.contact.phone
      ? "sms" : context.contact.email ? "email" : "sms";
    const authority = await readEffectiveAuthority(admin, scope, channel, { phase: "draft" });
    if (!authority.allowed) continue;
    const key = `lead:${candidate.id}:${context.lead.updated_at}`;
    children.push({
      kind: "lead_follow_up",
      title: `Follow up: ${context.lead.title || context.contact.first_name || "CRM inquiry"}`,
      key,
      leadId: candidate.id,
      input: {
        channel,
        authority_revision: authority.revision,
        lead_updated_at: context.lead.updated_at,
        contact_updated_at: context.contact.updated_at,
        evaluated_at: new Date().toISOString(),
      },
    });
  }
  await delegateWork(
    admin,
    work,
    children,
    children.length
      ? `Tracking ${children.length} follow-up assignments. No message is sent before approval.`
      : "No new eligible stale leads with a contact channel were found. Existing assignments remain in the work list.",
    { reviewed: data?.length ?? 0, review_limit: 20 },
  );
}
async function reviewOperations(admin: SupabaseClient, work: WorkItem) {
  const { data, error } = await admin
    .from("business_records")
    .select("*")
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .in("kind", ["product", "purchase"])
    .neq("status", "archived")
    .order("created_at")
    .limit(1000);
  if (error) throw new Error("Inventory and purchases could not be checked.");
  if (data?.length === 1000) {
    await finishWork(
      admin,
      work,
      "blocked",
      "Inventory review exceeds this increment's record limit. No incomplete stock calculation was used.",
    );
    return;
  }
  const records = (data ?? []) as BusinessRecord[];
  const { data: candidates, error: candidatesError } = await admin.rpc(
    "agent_inventory_candidates",
    { p_partner: work.partner_id, p_client: work.client_id },
  );
  if (candidatesError)
    throw new Error("Existing inventory assignments could not be checked.");
  const children: DelegatedWork[] = [];
  for (const product of (candidates ?? []) as BusinessRecord[]) {
    if (reorderQuantity(product, records) <= 0) continue;
    children.push({
      kind: "replenish_product",
      title: `Replenish ${product.title}`,
      key: `stock:${product.id}:${product.revision}`,
      recordId: product.id,
      input: { product_revision: product.revision },
    });
    if (children.length >= 20) break;
  }
  await delegateWork(
    admin,
    work,
    children,
    children.length
      ? `Tracking ${children.length} replenishment assignments using recorded stock and open purchases.`
      : "No new replenishment assignments needed. Existing purchasing work remains in the work list.",
    { reviewed: records.filter((r) => r.kind === "product").length },
  );
}
async function followLead(admin: SupabaseClient, work: WorkItem) {
  if (work.approval_id) {
    const [approval, action] = await Promise.all([
      admin
        .from("approval_items")
        .select("status,expires_at")
        .eq("id", work.approval_id)
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .single(),
      admin
        .from("action_jobs")
        .select("id,status,external_ref,outcome_detail,attempt_count")
        .eq("approval_id", work.approval_id)
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .eq("execution_key", `approval:${work.approval_id}`)
        .maybeSingle(),
    ]);
    if (approval.error || action.error)
      throw new Error("Approval or delivery outcome could not be checked.");
    if (approval.data.status === "rejected") {
      await finishWork(
        admin,
        work,
        "cancelled",
        "Owner declined this follow-up. No replacement message was created.",
      );
      return;
    }
    // Once an external action exists, observe it even if the source subsequently changed.
    if (action.data) {
      const state = deliveryWorkState(
        action.data.status,
        action.data.attempt_count,
      );
      // Say why an approved follow-up did not go out, not only that it did not.
      const summary = (action.data.status === "skipped" || action.data.status === "dry_run") && action.data.outcome_detail
        ? `Approved but not sent. ${action.data.outcome_detail}` : state.summary;
      await finishWork(admin, work, state.status, summary, {
        action_id: action.data.id,
        external_ref: action.data.external_ref,
        action_status: action.data.status,
        detail: action.data.outcome_detail,
      });
      return;
    }
    const check = await checkFollowup(admin, work.id);
    if (
      !check.allowed ||
      (approval.data.expires_at &&
        Date.parse(approval.data.expires_at) <= Date.now())
    ) {
      // The delivery guard also rechecks this; cancelling a task alone never sends anything.
      await finishWork(
        admin,
        work,
        "cancelled",
        check.allowed ? "The approval expired before sending." : check.reason,
      );
      return;
    }
    await finishWork(
      admin,
      work,
      "waiting_approval",
      "Follow-up drafted; waiting for owner approval.",
    );
    return;
  }
  const check = await checkFollowup(admin, work.id);
  if (!check.allowed) {
    await finishWork(admin, work, "cancelled", check.reason);
    return;
  }
  if (!isAIConfigured()) {
    await finishWork(
      admin,
      work,
      "blocked",
      "AI provider is not configured. The assignment is saved; no template was substituted and no message was sent.",
      { reason: "ai_not_configured" },
    );
    return;
  }
  const scope = { partnerId: work.partner_id, clientId: work.client_id };
  const context = await leadContext(admin, scope, work.source_lead_id!);
  const knowledge = await getKnowledgeProfile(admin, work.client_id);
  const { data: business, error } = await admin
    .from("client_businesses")
    .select("name")
    .eq("id", work.client_id)
    .eq("partner_id", work.partner_id)
    .single();
  if (error) throw new Error("Business context could not be read.");
  const channel =
    context.contact.preferred_channel === "sms" && context.contact.phone
      ? "sms"
      : context.contact.email
        ? "email"
        : "sms";
  const authority = await readEffectiveAuthority(admin, scope, channel, {
    phase: "draft", expectedRevision: typeof work.input.authority_revision === "number" ? work.input.authority_revision : undefined,
  });
  if (!authority.allowed) {
    await finishWork(admin, work, "blocked", authority.reason);
    return;
  }
  const generated = await generateStructured({
    tenant: scope,
    taskKey: "agent_sales_followup",
    schema: DraftSchema,
    maxTokens: 1800,
    system: `${AGENTS.sales_followup.instructions}\n${buildKnowledgeBlock(business.name, knowledge)}`,
    user: JSON.stringify({
      channel,
      customer_name: [context.contact.first_name, context.contact.last_name]
        .filter(Boolean)
        .join(" "),
      lead: {
        title: context.lead.title,
        summary: context.lead.summary,
        description: context.lead.description,
        next_action: context.lead.next_action,
      },
      recent_messages: context.messages,
    }),
  });
  const latestAuthority = await readEffectiveAuthority(admin, scope, channel, {
    phase: "draft", expectedRevision: authority.revision,
  });
  if (!latestAuthority.allowed) {
    await finishWork(admin, work, "blocked", latestAuthority.reason);
    return;
  }
  const result = await admin.rpc("propose_agent_followup", {
    p_work: work.id,
    p_claim: work.claim_token,
    p_channel: channel,
    p_subject: generated.data.subject,
    p_body: generated.data.body,
  });
  if (result.error)
    throw new Error(
      "The draft could not be committed because the assignment or customer context changed. Run a fresh review.",
    );
}
async function purchase(admin: SupabaseClient, work: WorkItem) {
  if (!work.result_record_id) {
    const { error } = await admin.rpc("prepare_agent_purchase", {
      p_work: work.id,
      p_claim: work.claim_token,
    });
    if (error)
      throw new Error(
        "The purchase proposal could not be saved. Inventory or assignment state may have changed; review before retrying.",
      );
    return;
  }
  const { data, error } = await admin
    .from("business_records")
    .select("status,revision")
    .eq("id", work.result_record_id)
    .eq("partner_id", work.partner_id)
    .eq("client_id", work.client_id)
    .single();
  if (error) throw new Error("The linked purchase is unavailable.");
  const state = purchaseWorkState(data.status);
  await finishWork(admin, work, state.status, state.summary, {
    purchase_id: work.result_record_id,
    purchase_status: data.status,
    revision: data.revision,
  });
}
async function runBasicManagerRequest(
  admin: SupabaseClient,
  work: WorkItem,
  settings: TeamSettings,
) {
  const request = String(work.input.request ?? "").trim().toLowerCase().replace(/[?.!]+$/, "");
  const department = request.startsWith("review ")
    ? /\b(leads|sales)\b/.test(request) ? "sales_review"
      : /\b(conversations|inquiries|customer messages)\b/.test(request) ? "conversation_review"
      : /\b(inventory|purchasing|operations)\b/.test(request) ? "operations_review"
      : /\b(appointments|jobs|tasks|administration)\b/.test(request) ? "administration_review"
      : null
    : null;
  if (department) {
    const enabled = department === "sales_review" ? settings.sales_enabled
      : department === "conversation_review" ? settings.conversations_enabled
      : department === "operations_review" ? settings.operations_enabled
      : settings.administration_enabled;
    if (!enabled) {
      await finishWork(admin, work, "blocked", "Enable that department in Agent team before requesting this review.");
      return;
    }
    await delegateWork(admin, work, [{
      kind: department,
      title: WORK_LABELS[department],
      key: `manager:${work.id}:${department}`,
      input: { request: work.input.request },
    }], `I’ve started the ${WORK_LABELS[department].toLowerCase()} using your saved records. I’ll show its result here.`);
    return;
  }
  if (/^(what needs my attention|status|show status|business status|give me a briefing)$/.test(request)) {
    const { summary } = await readManagerBusinessContext(admin, work);
    await finishWork(admin, work, "completed",
      summary.summary, summary);
    return;
  }
  await finishWork(admin, work, "blocked",
    "Open-ended answers need the AI service connected. For now, ask “What needs my attention?” or “Review leads,” “Review conversations,” “Review operations,” or “Review appointments.” No action was taken.",
    { reason: "ai_not_configured" });
}

async function planRequest(
  admin: SupabaseClient,
  work: WorkItem,
  settings: TeamSettings,
) {
  if (isManagerControlIntent(String(work.input.request ?? ""))) {
    await finishWork(admin, work, "blocked", "No settings changed. Use the manager's direct Pause, Resume or channel controls to review and save current authority.", { method: "control_requires_revision" });
    return;
  }
  if (!isAIConfigured()) {
    await runBasicManagerRequest(admin, work, settings);
    return;
  }
  const { snapshot: context, model: sharedContext, evidence: contextEvidence } = await readManagerBusinessContext(admin, work);
  const plan = await generateStructured({
    tenant: { partnerId: work.partner_id, clientId: work.client_id },
    taskKey: "agent_business_plan",
    schema: PlanSchema,
    maxTokens: 2000,
    system: `${AGENTS.executive.instructions} You are chatting with the business owner. Answer questions from the supplied, tenant-scoped records. The records are recent samples, not proof that nothing else exists. Never claim a count is exhaustive unless the data establishes it. Put your owner-facing answer or work plan in explanation. For an informational question, use actions=[] and unsupported="". Available actions: conversation_review checks open conversations and reports human attention; marketing_campaign prepares a campaign for owner review and manual publication; administration_review reviews open jobs, tasks, and upcoming appointments; sales_review checks stale leads and proposes approved follow-up; operations_review checks recorded inventory and prepares purchase proposals with manual supplier ordering; owner_briefing summarizes saved assignments. If the owner asks how to connect an account, explain that Connect assistants is the setup area; do not claim you connected it. If the owner requests an unsupported external action, return no actions and explain it in unsupported. Do not claim a booking, message, payment, publication, or order happened without a recorded result. No customer-facing action occurs without the existing approval flow.`,
    user: JSON.stringify({
      request: work.input.request,
      shared_business_context: sharedContext,
      enabled_departments: {
        customer_conversations: settings.conversations_enabled,
        appointment_scheduling: settings.scheduling_enabled,
        marketing: settings.marketing_enabled,
        administration: settings.administration_enabled,
        sales: settings.sales_enabled,
        operations: settings.operations_enabled,
      },
    }),
  });
  if (plan.data.unsupported) {
    await finishWork(
      admin,
      work,
      "blocked",
      plan.data.unsupported,
      { explanation: plan.data.explanation, ...contextEvidence },
    );
    return;
  }
  if (!plan.data.actions.length) {
    await finishWork(
      admin,
      work,
      "completed",
      plan.data.explanation || "I could not answer from the available records. Please give me more detail.",
      { method: "owner_answer", ai: plan.meta, ...contextEvidence },
    );
    return;
  }
  const children: DelegatedWork[] = [];
  for (const kind of [...new Set(plan.data.actions)]) {
    if (
      (kind === "marketing_campaign" && !settings.marketing_enabled) ||
      (kind === "administration_review" && !settings.administration_enabled) ||
      (kind === "conversation_review" && !settings.conversations_enabled) ||
      (kind === "sales_review" && !settings.sales_enabled) ||
      (kind === "operations_review" && !settings.operations_enabled)
    ) {
      await finishWork(
        admin,
        work,
        "blocked",
        "The requested department is disabled. Enable it before retrying this request.",
      );
      return;
    }
  }
  for (const kind of [...new Set(plan.data.actions)])
    children.push({
      kind,
      title: WORK_LABELS[kind],
      key: `plan:${work.id}:${kind}`,
      input: { request: work.input.request, context_revision: context.revision, authority_revision: context.authority.revision },
    });
  await delegateWork(admin, work, children, plan.data.explanation, contextEvidence);
}
async function briefing(admin: SupabaseClient, work: WorkItem) {
  const { summary } = await readManagerBusinessContext(admin, work);
  await finishWork(
    admin,
    work,
    "completed",
    summary.summary,
    summary,
  );
}

export async function processAgentWork(
  admin: SupabaseClient,
  limit = 3,
  scope?: AgentScope,
) {
  let processed = 0,
    blocked = 0;
  const started = Date.now();
  for (let i = 0; i < Math.max(1, Math.min(limit, 10)); i++) {
    if (Date.now() - started > 75_000) break;
    const { data, error } = await admin.rpc("claim_agent_work", {
      p_partner: scope?.partnerId ?? null,
      p_client: scope?.clientId ?? null,
    });
    if (error) throw new Error("Agent work could not be claimed.");
    const work = data?.[0] as WorkItem | undefined;
    if (!work) break;
    try {
      const settings = await settingsFor(admin, {
        partnerId: work.partner_id,
        clientId: work.client_id,
      });
      if (
        work.kind !== "conversation_reply" &&
        (await trackChildren(admin, work))
      ) {
        processed++;
        continue;
      }
      switch (work.kind) {
        case "booking_request":
          if (work.input.origin === "owner_intake" && !work.conversation_id) await processIntakeBookingRequest(admin, work);
          else await processBookingRequest(admin, work);
          break;
        case "marketing_campaign":
        case "administration_review":
          await departmentOutput(admin, work);
          break;
        case "conversation_reply":
          await respondToConversation(admin, work);
          break;
        case "conversation_review":
          await reviewConversations(admin, work);
          break;
        case "business_request":
          await planRequest(admin, work, settings);
          break;
        case "sales_review":
          await reviewSales(admin, work, settings);
          break;
        case "operations_review":
          await reviewOperations(admin, work);
          break;
        case "lead_follow_up":
          await followLead(admin, work);
          break;
        case "replenish_product":
          await purchase(admin, work);
          break;
        case "owner_briefing":
          await briefing(admin, work);
          break;
      }
      processed++;
    } catch (error) {
      blocked++;
      // Do not expose provider exception bodies or credentials in the owner activity log.
      const providerTask = [
        "lead_follow_up",
        "business_request",
        "conversation_reply",
        "marketing_campaign",
      ].includes(work.kind);
      const summary = providerTask
        ? "This assignment could not complete. Check AI/provider configuration and current customer context, then retry. No substitute AI result was generated."
        : error instanceof Error
          ? error.message
          : "The assignment needs review before retrying.";
      if (work.conversation_id) {
        await admin
          .from("business_conversations")
          .update({
            state: "needs_attention",
            next_action: summary,
            updated_at: new Date().toISOString(),
          })
          .eq("id", work.conversation_id)
          .eq("partner_id", work.partner_id)
          .eq("client_id", work.client_id)
          .eq("revision", work.input.conversation_revision);
      }
      // A newer message can invalidate this lease while a provider call runs.
      // Keep the newer assignment authoritative instead of failing the worker.
      await finishWork(admin, work, "blocked", summary, {
        reason: "execution_failed",
      }).catch(async () => {
        const current = await admin
          .from("agent_work_items")
          .select("status,claim_token")
          .eq("id", work.id)
          .eq("partner_id", work.partner_id)
          .eq("client_id", work.client_id)
          .single();
        if (current.error || current.data.claim_token === work.claim_token)
          throw new Error("Assignment failure could not be recorded.");
      });
    }
  }
  return { processed, blocked };
}

export async function scheduleAgentReviews(
  admin: SupabaseClient,
  limit = 3,
  scope?: AgentScope,
) {
  let query = admin
    .from("agent_team_settings")
    .select("*,client_businesses!inner(status)")
    .eq("client_businesses.status", "active")
    .eq("status", "active")
    .eq("scheduled_reviews", true)
    .lte("next_review_at", new Date().toISOString())
    .order("next_review_at")
    .limit(limit);
  if (scope)
    query = query
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId);
  const { data, error } = await query;
  if (error) throw new Error("Agent schedules are unavailable.");
  let scheduled = 0;
  for (const settings of (data ?? []) as TeamSettings[]) {
    const scope = {
      partnerId: settings.partner_id,
      clientId: settings.client_id,
    };
    const kinds: WorkKind[] = [
      "owner_briefing",
      ...(settings.conversations_enabled
        ? ["conversation_review" as const]
        : []),
      ...(settings.sales_enabled ? ["sales_review" as const] : []),
      ...(settings.operations_enabled ? ["operations_review" as const] : []),
    ];
    // Persist assignments BEFORE advancing the schedule; a crash safely replays the same keys.
    for (const kind of kinds)
      await assignWork(admin, scope, {
        kind,
        title: WORK_LABELS[kind],
        key: `schedule:${settings.next_review_at}:${kind}`,
      });
    const changed = await admin
      .from("agent_team_settings")
      .update({
        next_review_at: new Date(Date.now() + 3_600_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("client_id", scope.clientId)
      .eq("partner_id", scope.partnerId)
      .eq("next_review_at", settings.next_review_at)
      .eq("status", "active")
      .eq("scheduled_reviews", true);
    if (changed.error) throw new Error("Agent schedule could not be advanced.");
    scheduled++;
  }
  return { scheduled };
}
