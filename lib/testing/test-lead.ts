import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

// In-app "send a test lead" (docs/21 testing ladder). Fires a realistic
// synthetic lead through the SAME pipeline every real lead uses:
// integration_event → intake router + lead-analysis workflow → AI analysis
// → approval-gated draft → built-in CRM contact/lead/note. Nothing here is
// special-cased: it is a normal form.submitted event, so what the partner
// watches is exactly what a real submission would do.
//
// - Rung 1 (nothing connected): every customer-facing action stays in
//   dry-run, so the partner sees the whole flow with zero setup and zero
//   real sends.
// - Rung 2/3 (Twilio / calendar / email connected + live): approving the
//   draft actually texts/books/emails — same buttons, real effect.
//
// Sample leads use stable identities so repeated fires additively update
// ONE built-in CRM contact each instead of spawning duplicates, and every
// message is prefixed [SAMPLE] so it is obvious wherever it surfaces.

type SampleLead = {
  key: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  service_need: string;
  urgency: "emergency" | "high" | "medium" | "low";
  appointment_preference: string;
  message: string;
};

const SAMPLE_LEADS: SampleLead[] = [
  {
    key: "water_heater",
    name: "Sarah Rivera",
    phone: "+15550100001",
    email: "sarah.sample@northstar-test.local",
    address: "128 Maple Street",
    service_need: "Leaking water heater",
    urgency: "high",
    appointment_preference: "Tomorrow morning if possible",
    message:
      "[SAMPLE] Hi, my water heater is leaking all over the garage floor and I need someone out as soon as you can. Mornings are best for me.",
  },
  {
    key: "ac_out",
    name: "Marcus Bell",
    phone: "+15550100002",
    email: "marcus.sample@northstar-test.local",
    address: "44 Orchard Lane",
    service_need: "AC not cooling",
    urgency: "medium",
    appointment_preference: "Any weekday afternoon",
    message:
      "[SAMPLE] Our AC stopped cooling last night and the house is getting warm. Could someone take a look this week? Afternoons work best.",
  },
  {
    key: "quote_reno",
    name: "Priya Shah",
    phone: "+15550100003",
    email: "priya.sample@northstar-test.local",
    address: "902 Birchwood Court",
    service_need: "Bathroom remodel quote",
    urgency: "low",
    appointment_preference: "No rush — next week is fine",
    message:
      "[SAMPLE] I'm planning a bathroom remodel and would like a quote. No rush, sometime next week would be great. Thanks!",
  },
];

export type TestLeadResult =
  | {
      ok: true;
      eventId: string;
      runId: string | null;
      scenarioName: string;
      runsStarted: number;
    }
  | { ok: false; error: string };

// Pick a scenario. Rotating by a caller-provided index keeps variety across
// fires; falls back to time-based rotation.
function pickScenario(index?: number): SampleLead {
  const i =
    typeof index === "number" && Number.isFinite(index)
      ? Math.abs(Math.trunc(index))
      : Math.floor(Date.now() / 1000);

  return SAMPLE_LEADS[i % SAMPLE_LEADS.length];
}

export async function sendTestLead(
  admin: SupabaseClient,
  input: { partnerId: string; clientId: string; scenarioIndex?: number },
): Promise<TestLeadResult> {
  const scenario = pickScenario(input.scenarioIndex);

  const eventData: Record<string, unknown> = {
    name: scenario.name,
    phone: scenario.phone,
    email: scenario.email,
    address: scenario.address,
    message: scenario.message,
    service_need: scenario.service_need,
    urgency: scenario.urgency,
    appointment_preference: scenario.appointment_preference,
    channel: "test",
    is_test: true,
  };

  const idempotencyKey = `test-lead-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const { data: insertedEvent, error: insertError } = await admin
    .from("integration_events")
    .insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      connection_id: null,
      direction: "inbound",
      event_type: "form.submitted",
      status: "received",
      idempotency_key: idempotencyKey,
      request_payload: redactAuditValue({
        event_type: "form.submitted",
        source: "test_lead",
        is_test: true,
        data: eventData,
      }),
      redacted: true,
    })
    .select("id")
    .single();

  if (insertError || !insertedEvent) {
    return { ok: false, error: "The test lead event could not be created." };
  }

  const eventId: string = insertedEvent.id;

  try {
    const engineResult = await runWorkflowsForEvent(admin, {
      id: eventId,
      partnerId: input.partnerId,
      clientId: input.clientId,
      connectionId: null,
      eventType: "form.submitted",
      data: eventData,
    });

    const runId = engineResult.runs[0]?.runId ?? null;

    await admin
      .from("integration_events")
      .update({ status: "processed", workflow_run_id: runId })
      .eq("id", eventId);

    return {
      ok: true,
      eventId,
      runId,
      scenarioName: scenario.name,
      runsStarted: engineResult.runs.length,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Workflow processing failed.";

    await admin
      .from("integration_events")
      .update({
        status: "failed",
        error_code: "processing_failed",
        error_message: message,
      })
      .eq("id", eventId);

    return {
      ok: false,
      error: `The test lead was stored but processing failed: ${message}`,
    };
  }
}
