export type BusinessReportRange = "30d" | "90d" | "365d" | "all";

export type ReportingLead = {
  id: string;
  status: string;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  created_at: string;
};

export type ReportingAppointment = {
  id: string;
  status: string;
  created_at: string;
};

export type ReportingCommunication = {
  id: string;
  direction: string;
  status: string;
  ai_generated: boolean;
  occurred_at: string;
};

export type ReportingCall = {
  id: string;
  direction: string;
  status: string;
  started_at: string;
};

export type ReportingQuote = {
  id: string;
  status: string;
  low_amount: number;
  high_amount: number;
  created_at: string;
};

export type ReportingWorkflow = {
  id: string;
  name: string;
};

export type ReportingWorkflowRun = {
  id: string;
  workflow_instance_id: string;
  status: string;
  summary: string | null;
  requires_approval: boolean;
  created_at: string;
  finished_at: string | null;
};

export type ReportingTimelineEntry = {
  id: string;
  actor_type: string;
  created_at: string;
};

export type BusinessReportTrendPoint = {
  label: string;
  leads: number;
  won: number;
  appointments: number;
  automationSuccesses: number;
};

export type WorkflowPerformance = {
  id: string;
  name: string;
  runs: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  lastOutcome: string | null;
  lastRunAt: string | null;
};

export type BusinessReport = {
  leadCount: number;
  wonCount: number;
  conversionRate: number;
  openPipelineCount: number;
  estimatedPipelineValue: number;
  estimatedWonValue: number;
  appointmentCount: number;
  completedAppointmentCount: number;
  quoteCount: number;
  acceptedQuoteCount: number;
  acceptedQuoteValue: number;
  communicationCount: number;
  inboundCommunicationCount: number;
  outboundCommunicationCount: number;
  aiGeneratedCommunicationCount: number;
  callCount: number;
  workflowRunCount: number;
  workflowSuccessCount: number;
  workflowFailureCount: number;
  workflowSuccessRate: number | null;
  approvalGatedRunCount: number;
  aiContributionCount: number;
  trend: BusinessReportTrendPoint[];
  stages: { label: string; value: number }[];
  workflows: WorkflowPerformance[];
  insights: string[];
};

const RANGE_DAYS: Record<Exclude<BusinessReportRange, "all">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

const FAILURE_STATES = new Set(["failed", "cancelled"]);

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function cutoffForRange(
  range: BusinessReportRange,
  now: Date,
): number | null {
  if (range === "all") return null;
  return now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
}

function inRange(value: string, cutoff: number | null, now: Date): boolean {
  const time = timestamp(value);
  return time > 0 && time <= now.getTime() && (cutoff === null || time >= cutoff);
}

function midpoint(
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): number {
  if (minimum != null && maximum != null) return (minimum + maximum) / 2;
  return minimum ?? maximum ?? 0;
}

function newestRun(
  runs: ReportingWorkflowRun[],
): ReportingWorkflowRun | null {
  return runs.reduce<ReportingWorkflowRun | null>((latest, run) => {
    if (!latest) return run;
    return timestamp(run.created_at) > timestamp(latest.created_at)
      ? run
      : latest;
  }, null);
}

export function buildBusinessReport(input: {
  leads: ReportingLead[];
  appointments: ReportingAppointment[];
  communications: ReportingCommunication[];
  calls: ReportingCall[];
  quotes: ReportingQuote[];
  workflows: ReportingWorkflow[];
  workflowRuns: ReportingWorkflowRun[];
  timeline: ReportingTimelineEntry[];
  range: BusinessReportRange;
  now?: Date;
}): BusinessReport {
  const now = input.now ?? new Date();
  const cutoff = cutoffForRange(input.range, now);
  const leads = input.leads.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const appointments = input.appointments.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const communications = input.communications.filter((item) =>
    inRange(item.occurred_at, cutoff, now),
  );
  const calls = input.calls.filter((item) =>
    inRange(item.started_at, cutoff, now),
  );
  const quotes = input.quotes.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const workflowRuns = input.workflowRuns.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const timeline = input.timeline.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const wonLeads = leads.filter((lead) => lead.status === "won");
  const openLeads = leads.filter(
    (lead) => !["won", "lost"].includes(lead.status),
  );
  const completedAppointments = appointments.filter(
    (appointment) => appointment.status === "completed",
  );
  const acceptedQuotes = quotes.filter(
    (quote) => quote.status === "accepted",
  );
  const workflowSuccesses = workflowRuns.filter(
    (run) => run.status === "succeeded",
  );
  const workflowFailures = workflowRuns.filter((run) =>
    FAILURE_STATES.has(run.status),
  );
  const completedWorkflowRuns =
    workflowSuccesses.length + workflowFailures.length;
  const periodStart =
    cutoff ??
    Math.min(
      ...[
        ...leads.map((item) => timestamp(item.created_at)),
        ...appointments.map((item) => timestamp(item.created_at)),
        ...workflowRuns.map((item) => timestamp(item.created_at)),
        now.getTime(),
      ],
    );
  const bucketCount = 8;
  const periodLength = Math.max(now.getTime() - periodStart, 1);
  const bucketLength = periodLength / bucketCount;
  const trend = Array.from({ length: bucketCount }, (_, index) => {
    const start = periodStart + bucketLength * index;
    const end =
      index === bucketCount - 1
        ? now.getTime() + 1
        : periodStart + bucketLength * (index + 1);
    const inside = (value: string) => {
      const time = timestamp(value);
      return time >= start && time < end;
    };

    return {
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(start)),
      leads: leads.filter((item) => inside(item.created_at)).length,
      won: wonLeads.filter((item) => inside(item.created_at)).length,
      appointments: appointments.filter((item) => inside(item.created_at))
        .length,
      automationSuccesses: workflowSuccesses.filter((item) =>
        inside(item.created_at),
      ).length,
    };
  });
  const workflowNameById = new Map(
    input.workflows.map((workflow) => [workflow.id, workflow.name]),
  );
  const workflowIds = [
    ...new Set([
      ...input.workflows.map((workflow) => workflow.id),
      ...workflowRuns.map((run) => run.workflow_instance_id),
    ]),
  ];
  const workflows = workflowIds
    .map((id): WorkflowPerformance => {
      const runs = workflowRuns.filter(
        (run) => run.workflow_instance_id === id,
      );
      const succeeded = runs.filter(
        (run) => run.status === "succeeded",
      ).length;
      const failed = runs.filter((run) =>
        FAILURE_STATES.has(run.status),
      ).length;
      const completed = succeeded + failed;
      const lastRun = newestRun(runs);

      return {
        id,
        name: workflowNameById.get(id) ?? "Automation",
        runs: runs.length,
        succeeded,
        failed,
        successRate:
          completed > 0 ? Math.round((succeeded / completed) * 100) : null,
        lastOutcome: lastRun?.summary ?? null,
        lastRunAt: lastRun?.finished_at ?? lastRun?.created_at ?? null,
      };
    })
    .filter((workflow) => workflow.runs > 0)
    .sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  const insights: string[] = [];

  if (leads.length > 0) {
    insights.push(
      `${wonLeads.length} of ${leads.length} leads became won customers, a ${Math.round((wonLeads.length / leads.length) * 100)}% conversion rate.`,
    );
  }
  if (completedWorkflowRuns > 0) {
    insights.push(
      `${workflowSuccesses.length} of ${completedWorkflowRuns} completed automation runs succeeded.`,
    );
  }
  if (workflowFailures.length > 0) {
    insights.push(
      `${workflowFailures.length} automation failure${workflowFailures.length === 1 ? " requires" : "s require"} partner review.`,
    );
  }

  return {
    leadCount: leads.length,
    wonCount: wonLeads.length,
    conversionRate:
      leads.length > 0
        ? Math.round((wonLeads.length / leads.length) * 100)
        : 0,
    openPipelineCount: openLeads.length,
    estimatedPipelineValue: openLeads.reduce(
      (sum, lead) =>
        sum +
        midpoint(lead.estimated_value_min, lead.estimated_value_max),
      0,
    ),
    estimatedWonValue: wonLeads.reduce(
      (sum, lead) =>
        sum +
        midpoint(lead.estimated_value_min, lead.estimated_value_max),
      0,
    ),
    appointmentCount: appointments.filter(
      (appointment) => appointment.status !== "cancelled",
    ).length,
    completedAppointmentCount: completedAppointments.length,
    quoteCount: quotes.length,
    acceptedQuoteCount: acceptedQuotes.length,
    acceptedQuoteValue: acceptedQuotes.reduce(
      (sum, quote) => sum + midpoint(quote.low_amount, quote.high_amount),
      0,
    ),
    communicationCount: communications.length,
    inboundCommunicationCount: communications.filter(
      (item) => item.direction === "inbound",
    ).length,
    outboundCommunicationCount: communications.filter(
      (item) => item.direction === "outbound",
    ).length,
    aiGeneratedCommunicationCount: communications.filter(
      (item) => item.ai_generated,
    ).length,
    callCount: calls.length,
    workflowRunCount: workflowRuns.length,
    workflowSuccessCount: workflowSuccesses.length,
    workflowFailureCount: workflowFailures.length,
    workflowSuccessRate:
      completedWorkflowRuns > 0
        ? Math.round(
            (workflowSuccesses.length / completedWorkflowRuns) * 100,
          )
        : null,
    approvalGatedRunCount: workflowRuns.filter(
      (run) => run.requires_approval,
    ).length,
    aiContributionCount: timeline.filter(
      (item) => item.actor_type === "ai_assistant",
    ).length,
    trend,
    stages: ["new", "contacted", "quoted", "scheduled", "won", "lost"].map(
      (stage) => ({
        label: stage.replace(/\b\w/g, (character) =>
          character.toUpperCase(),
        ),
        value: leads.filter((lead) => lead.status === stage).length,
      }),
    ),
    workflows,
    insights,
  };
}
