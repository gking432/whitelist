import type { SupabaseClient } from "@supabase/supabase-js";

import { analyzeSupportTicket } from "@/lib/support/triage";
import type { SupportHealthContext, SupportOrigin } from "@/lib/support/types";

export async function loadSupportHealthContext(
  supabase: SupabaseClient,
  clientId: string | null,
): Promise<SupportHealthContext> {
  if (!clientId) {
    return {
      failingConnections: 0,
      recentFailedRuns: 0,
      recentSuccessfulRuns: 0,
      latestError: null,
    };
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: failingConnections }, { data: runs }] = await Promise.all([
    supabase
      .from("integration_connections")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .in("status", ["needs_attention", "failing"]),
    supabase
      .from("workflow_runs")
      .select("status, error_message, created_at")
      .eq("client_id", clientId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const recentRuns = runs ?? [];
  const failed = recentRuns.filter((run) => run.status === "failed");
  return {
    failingConnections: failingConnections ?? 0,
    recentFailedRuns: failed.length,
    recentSuccessfulRuns: recentRuns.filter((run) => run.status === "succeeded").length,
    latestError: failed.find((run) => run.error_message)?.error_message ?? null,
  };
}

export async function triageAndPersistSupportTicket(input: {
  supabase: SupabaseClient;
  ticketId: string;
  partnerId: string;
  clientId: string | null;
  origin: SupportOrigin;
  title: string;
  description: string;
  affectedArea?: string | null;
}) {
  const health = await loadSupportHealthContext(input.supabase, input.clientId);
  const result = await analyzeSupportTicket({
    origin: input.origin,
    title: input.title,
    description: input.description,
    affectedArea: input.affectedArea,
    health,
  });
  const route = input.origin === "client"
    ? "partner"
    : result.triage.recommendedRoute === "codex"
      ? "platform"
      : result.triage.recommendedRoute;

  const { error } = await input.supabase
    .from("support_tickets")
    .update({
      category: result.triage.category,
      priority: result.triage.priority,
      status: "triaged",
      current_route: route,
      ai_summary: result.triage.summary,
      ai_diagnosis: result.triage.diagnosis,
      ai_recommended_action: result.triage.recommendedAction,
      ai_recommended_route: result.triage.recommendedRoute,
      ai_confidence: result.triage.confidence,
      ai_metadata: {
        ...result.metadata,
        source: result.source,
        health,
      },
    })
    .eq("id", input.ticketId)
    .eq("partner_id", input.partnerId);

  if (error) throw new Error(`Could not save support triage: ${error.message}`);

  await Promise.all([
    input.supabase.from("support_ticket_messages").insert({
      ticket_id: input.ticketId,
      partner_id: input.partnerId,
      client_id: input.clientId,
      author_id: null,
      author_kind: "ai",
      audience: "partner",
      body: `${result.triage.diagnosis}\n\nRecommended next step: ${result.triage.recommendedAction}`,
    }),
    input.supabase.from("support_ticket_events").insert({
      ticket_id: input.ticketId,
      partner_id: input.partnerId,
      client_id: input.clientId,
      actor_id: null,
      event_type: "ticket.triaged",
      audience: "partner",
      summary: `Triaged as ${result.triage.category.replaceAll("_", " ")} and routed to ${route.replaceAll("_", " ")}.`,
      metadata: { source: result.source, health },
    }),
  ]);

  return result;
}
