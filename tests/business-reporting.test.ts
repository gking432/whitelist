import assert from "node:assert/strict";
import test from "node:test";

import { buildBusinessReport } from "../lib/crm/business-reporting.ts";

const now = new Date("2026-07-25T12:00:00.000Z");
const baseInput = {
  leads: [
    {
      id: "lead-won",
      status: "won",
      estimated_value_min: 8000,
      estimated_value_max: 12000,
      created_at: "2026-07-05T12:00:00.000Z",
    },
    {
      id: "lead-open",
      status: "quoted",
      estimated_value_min: 4000,
      estimated_value_max: 6000,
      created_at: "2026-07-10T12:00:00.000Z",
    },
  ],
  appointments: [
    {
      id: "appointment-1",
      status: "completed",
      created_at: "2026-07-11T12:00:00.000Z",
    },
  ],
  communications: [
    {
      id: "message-1",
      direction: "outbound",
      status: "sent",
      ai_generated: true,
      occurred_at: "2026-07-12T12:00:00.000Z",
    },
  ],
  calls: [
    {
      id: "call-1",
      direction: "inbound",
      status: "completed",
      started_at: "2026-07-13T12:00:00.000Z",
    },
  ],
  quotes: [
    {
      id: "quote-1",
      status: "accepted",
      low_amount: 9000,
      high_amount: 11000,
      created_at: "2026-07-14T12:00:00.000Z",
    },
  ],
  workflows: [
    {
      id: "workflow-1",
      name: "Speed to lead",
    },
  ],
  workflowRuns: [
    {
      id: "run-1",
      workflow_instance_id: "workflow-1",
      status: "succeeded",
      summary: "Reply drafted.",
      requires_approval: true,
      created_at: "2026-07-15T12:00:00.000Z",
      finished_at: "2026-07-15T12:01:00.000Z",
    },
    {
      id: "run-2",
      workflow_instance_id: "workflow-1",
      status: "failed",
      summary: "Provider rejected delivery.",
      requires_approval: false,
      created_at: "2026-07-16T12:00:00.000Z",
      finished_at: "2026-07-16T12:01:00.000Z",
    },
  ],
  timeline: [
    {
      id: "timeline-1",
      actor_type: "ai_assistant",
      created_at: "2026-07-15T12:00:00.000Z",
    },
  ],
};

test("executive report separates estimated won and pipeline value", () => {
  const report = buildBusinessReport({
    ...baseInput,
    range: "30d",
    now,
  });

  assert.equal(report.leadCount, 2);
  assert.equal(report.wonCount, 1);
  assert.equal(report.conversionRate, 50);
  assert.equal(report.estimatedWonValue, 10000);
  assert.equal(report.estimatedPipelineValue, 5000);
  assert.equal(report.acceptedQuoteValue, 10000);
});

test("automation outcomes use completed runs for success rate", () => {
  const report = buildBusinessReport({
    ...baseInput,
    workflowRuns: [
      ...baseInput.workflowRuns,
      {
        ...baseInput.workflowRuns[0],
        id: "run-queued",
        status: "queued",
      },
    ],
    range: "30d",
    now,
  });

  assert.equal(report.workflowRunCount, 3);
  assert.equal(report.workflowSuccessCount, 1);
  assert.equal(report.workflowFailureCount, 1);
  assert.equal(report.workflowSuccessRate, 50);
  assert.equal(report.approvalGatedRunCount, 2);
  assert.equal(report.workflows[0]?.lastOutcome, "Provider rejected delivery.");
});

test("report counts real customer and AI activity", () => {
  const report = buildBusinessReport({
    ...baseInput,
    range: "30d",
    now,
  });

  assert.equal(report.appointmentCount, 1);
  assert.equal(report.completedAppointmentCount, 1);
  assert.equal(report.communicationCount, 1);
  assert.equal(report.aiGeneratedCommunicationCount, 1);
  assert.equal(report.callCount, 1);
  assert.equal(report.aiContributionCount, 1);
});

test("date range excludes old outcomes", () => {
  const report = buildBusinessReport({
    ...baseInput,
    leads: [
      ...baseInput.leads,
      {
        ...baseInput.leads[0],
        id: "old-lead",
        created_at: "2025-01-01T12:00:00.000Z",
      },
    ],
    range: "30d",
    now,
  });

  assert.equal(report.leadCount, 2);
});

test("empty report returns zeroes without manufactured outcomes", () => {
  const report = buildBusinessReport({
    leads: [],
    appointments: [],
    communications: [],
    calls: [],
    quotes: [],
    workflows: [],
    workflowRuns: [],
    timeline: [],
    range: "90d",
    now,
  });

  assert.equal(report.leadCount, 0);
  assert.equal(report.workflowSuccessRate, null);
  assert.deepEqual(report.workflows, []);
  assert.deepEqual(report.insights, []);
});
