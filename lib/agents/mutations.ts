import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ClientPortal } from "@/lib/clients/portal";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { WORK_LABELS } from "./catalog";
import { assignWork } from "./store";
import { isManagerControlIntent } from "../business/context-commands";

const Mutation = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("settings"),
      status: z.enum(["active", "paused"]),
      marketing_enabled: z.boolean().default(false),
      administration_enabled: z.boolean().default(false),
      conversations_enabled: z.boolean().default(false),
      scheduling_enabled: z.boolean().default(false),
      sales_enabled: z.boolean(),
      operations_enabled: z.boolean(),
      scheduled_reviews: z.boolean(),
      lead_stale_hours: z.number().int().min(1).max(720),
    })
    .strict(),
  z
    .object({
      action: z.literal("review"),
      kind: z.enum([
        "marketing_campaign",
        "administration_review",
        "conversation_review",
        "sales_review",
        "operations_review",
        "owner_briefing",
      ]),
      key: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("request"),
      request: z.string().trim().min(5).max(2000),
      key: z.uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("control"),
      id: z.uuid(),
      revision: z.number().int().positive(),
      transition: z.enum(["retry", "cancel"]),
    })
    .strict(),
]);

export async function mutateTeam(
  admin: SupabaseClient,
  portal: Extract<ClientPortal, { kind: "ok" }>,
  raw: unknown,
) {
  if (!canWriteBusinessWorkspace(portal.access))
    throw new Error("This account cannot change the agent team.");
  const input = Mutation.parse(raw);
  if (input.action === "request" && isManagerControlIntent(input.request))
    throw new Error("No settings changed. Use the manager's Pause, Resume or channel controls, which check your current permission revision.");
  const scope = {
    partnerId: portal.client.partner_id,
    clientId: portal.client.id,
  };
  if (input.action === "settings") {
    const { action: _action, ...settings } = input;
    const { error } = await admin.from("agent_team_settings").upsert(
      {
        ...settings,
        partner_id: scope.partnerId,
        client_id: scope.clientId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
    if (error) throw new Error("Team settings could not be saved.");
    return {
      message:
        settings.status === "paused"
          ? "Team paused. Previously completed actions are not undone."
          : "Team settings saved.",
    };
  }
  if (input.action === "control") {
    const { error } = await admin.rpc("control_agent_work", {
      p_partner: scope.partnerId,
      p_client: scope.clientId,
      p_id: input.id,
      p_revision: input.revision,
      p_action: input.transition,
    });
    if (error)
      throw new Error(
        "The assignment changed or cannot perform that transition. Refresh and try again.",
      );
    return {
      message:
        input.transition === "retry"
          ? "Saved work queued for a recheck."
          : "Assignment stopped. Actions already accepted by providers are not undone.",
    };
  }
  const { data: settings, error } = await admin
    .from("agent_team_settings")
    .select(
      "status,sales_enabled,operations_enabled,conversations_enabled,marketing_enabled,administration_enabled",
    )
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error || settings?.status !== "active")
    throw new Error("Activate the team before assigning work.");
  if (
    input.action === "review" &&
    ((input.kind === "marketing_campaign" && !settings.marketing_enabled) ||
      (input.kind === "administration_review" &&
        !settings.administration_enabled) ||
      (input.kind === "conversation_review" &&
        !settings.conversations_enabled) ||
      (input.kind === "sales_review" && !settings.sales_enabled) ||
      (input.kind === "operations_review" && !settings.operations_enabled))
  )
    throw new Error("Enable this department before starting its review.");
  const kind = input.action === "request" ? "business_request" : input.kind;
  const id = await assignWork(admin, scope, {
    kind,
    title:
      input.action === "request"
        ? input.request.slice(0, 180)
        : WORK_LABELS[kind],
    key: `owner:${input.key}`,
    input: input.action === "request" ? { request: input.request } : {},
  });
  return {
    id,
    message: "Assignment saved. The team will process it in the background.",
  };
}
