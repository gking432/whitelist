import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { generateStructured, isAIConfigured } from "@/lib/ai/provider";
import {
  getKnowledgeProfile,
  buildKnowledgeBlock,
} from "@/lib/knowledge/profile";
import { finishWork } from "./store";
import type { WorkItem } from "./types";
const Campaign = z.object({
  title: z.string().min(1).max(180),
  body: z.string().min(1).max(12000),
  audience: z.string().max(500),
  channel: z.enum(["Email", "Social", "Website"]),
});
export async function departmentOutput(admin: SupabaseClient, work: WorkItem) {
  if (work.result_record_id) {
    const { data, error } = await admin
      .from("business_records")
      .select("status,title")
      .eq("id", work.result_record_id)
      .eq("partner_id", work.partner_id)
      .eq("client_id", work.client_id)
      .single();
    if (error) throw new Error("Prepared work could not be checked.");
    await finishWork(
      admin,
      work,
      ["approved", "published"].includes(data.status)
        ? "completed"
        : ["rejected", "archived"].includes(data.status)
          ? "cancelled"
          : "waiting_approval",
      data.status === "published"
        ? "Owner recorded publication."
        : data.status === "approved"
          ? "Campaign approved and ready for the owner to publish. Approval alone does not publish."
          : "Prepared campaign is awaiting owner review.",
      { record_id: work.result_record_id },
    );
    return;
  }
  let title = "",
    body = "",
    metadata: Record<string, unknown> = {};
  if (work.kind === "marketing_campaign") {
    if (!isAIConfigured()) {
      await finishWork(
        admin,
        work,
        "blocked",
        "AI is not configured. No campaign was generated.",
      );
      return;
    }
    const [profile, knowledge] = await Promise.all([
      admin
        .from("business_workspace_profiles")
        .select("profile")
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .maybeSingle(),
      getKnowledgeProfile(admin, work.client_id),
    ]);
    if (profile.error || !profile.data)
      throw new Error(
        "Complete the business profile before preparing a campaign.",
      );
    const generated = await generateStructured({
      tenant: { partnerId: work.partner_id, clientId: work.client_id },
      taskKey: "agent_marketing_campaign",
      schema: Campaign,
      maxTokens: 3500,
      system: `Prepare one useful campaign for this business: audience, objective, copy, and a concrete next step. Use only the supplied approved facts. Never invent prices, discounts, claims, testimonials, results, or offers. Do not include private customer data. The owner reviews and publishes.\n${buildKnowledgeBlock("the business", knowledge)}`,
      user: JSON.stringify({
        request:
          work.input.request ??
          "Prepare one campaign based on the recorded business goals.",
        business: profile.data.profile,
      }),
    });
    title = generated.data.title;
    body = generated.data.body;
    metadata = {
      channel: generated.data.channel,
      audience: generated.data.audience,
      objective: String(work.input.request ?? "Business marketing").slice(
        0,
        4000,
      ),
      budget: 0,
      ai: generated.meta,
    };
  } else {
    const [jobs, tasks, appointments] = await Promise.all([
      admin
        .from("business_records")
        .select("id,title,status,data")
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .eq("kind", "job")
        .not("status", "in", "(completed,archived)")
        .order("updated_at")
        .limit(100),
      admin
        .from("crm_tasks")
        .select("id,title,status,due_at")
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .eq("status", "open")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(100),
      admin
        .from("crm_appointments")
        .select("id,title,status,start_at")
        .eq("partner_id", work.partner_id)
        .eq("client_id", work.client_id)
        .gte("start_at", new Date().toISOString())
        .lte("start_at", new Date(Date.now() + 7 * 86400000).toISOString())
        .order("start_at")
        .limit(100),
    ]);
    if (jobs.error || tasks.error || appointments.error)
      throw new Error("Operations records could not be checked.");
    title = "Operations and administration review";
    const sections = [
      [
        "Open jobs",
        (jobs.data ?? []).map(
          (j) =>
            `${j.title} — ${j.status}${j.data?.assignee ? "" : "; unassigned"}${j.data?.due_date ? `; due ${j.data.due_date}` : ""}`,
        ),
      ],
      [
        "Open CRM tasks",
        (tasks.data ?? []).map(
          (t) => `${t.title}${t.due_at ? `; due ${t.due_at}` : ""}`,
        ),
      ],
      [
        "Appointments in the next week",
        (appointments.data ?? []).map(
          (a) => `${a.title} — ${a.status}; ${a.start_at}`,
        ),
      ],
    ] as const;
    body = sections
      .map(
        ([label, rows]) =>
          `${label}\n${rows.length ? rows.map((r) => `• ${r}`).join("\n") : "No records."}`,
      )
      .join("\n\n");
    metadata = {
      method: "record_review",
      reviewed_at: new Date().toISOString(),
      job_ids: jobs.data?.map((r) => r.id),
      task_ids: tasks.data?.map((r) => r.id),
      appointment_ids: appointments.data?.map((r) => r.id),
    };
  }
  const result = await admin.rpc("save_agent_business_output", {
    p_work: work.id,
    p_claim: work.claim_token,
    p_title: title,
    p_body: body,
    p_data: metadata,
  });
  if (result.error)
    throw new Error("Assignment changed or its output could not be saved.");
}
