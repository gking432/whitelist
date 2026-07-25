export type MarketingDateRange = "30d" | "90d" | "365d" | "all";

export type MarketingContact = {
  id: string;
  source: string | null;
  created_at: string;
};

export type MarketingLead = {
  id: string;
  contact_id: string;
  status: string;
  source_event_type: string | null;
  estimated_value_min: number | null;
  estimated_value_max: number | null;
  created_at: string;
};

export type MarketingAppointment = {
  id: string;
  contact_id: string | null;
  status: string;
  created_at: string;
};

export type MarketingFeedback = {
  id: string;
  source: string;
  rating: number | null;
  sentiment: string;
  risk_level: string;
  summary: string;
  created_at: string;
};

export type MarketingSourcePerformance = {
  source: string;
  label: string;
  leads: number;
  appointments: number;
  won: number;
  conversionRate: number;
  estimatedRevenue: number;
};

export type MarketingTrendPoint = {
  label: string;
  leads: number;
  won: number;
};

export type MarketingAnalytics = {
  leadCount: number;
  appointmentCount: number;
  wonCount: number;
  conversionRate: number;
  estimatedRevenue: number;
  averageRating: number | null;
  reviewCount: number;
  highRiskReviewCount: number;
  positiveReviewCount: number;
  negativeReviewCount: number;
  availableSources: { value: string; label: string }[];
  sources: MarketingSourcePerformance[];
  trend: MarketingTrendPoint[];
  funnel: { label: string; value: number }[];
  recentFeedback: MarketingFeedback[];
  insights: string[];
};

const RANGE_DAYS: Record<Exclude<MarketingDateRange, "all">, number> = {
  "30d": 30,
  "90d": 90,
  "365d": 365,
};

function timestamp(value: string): number {
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sourceKey(value: string | null | undefined): string {
  const cleaned = value?.trim().toLowerCase().replaceAll(" ", "_");
  return cleaned || "unattributed";
}

export function marketingSourceLabel(value: string): string {
  if (value === "unattributed") return "Unattributed";

  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function estimatedLeadValue(lead: MarketingLead): number {
  if (lead.estimated_value_min !== null && lead.estimated_value_max !== null) {
    return (lead.estimated_value_min + lead.estimated_value_max) / 2;
  }
  return lead.estimated_value_min ?? lead.estimated_value_max ?? 0;
}

function cutoffForRange(
  range: MarketingDateRange,
  now: Date,
): number | null {
  if (range === "all") return null;
  return now.getTime() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
}

function inRange(value: string, cutoff: number | null, now: Date): boolean {
  const time = timestamp(value);
  return time > 0 && time <= now.getTime() && (cutoff === null || time >= cutoff);
}

export function buildMarketingAnalytics(input: {
  contacts: MarketingContact[];
  leads: MarketingLead[];
  appointments: MarketingAppointment[];
  feedback: MarketingFeedback[];
  range: MarketingDateRange;
  selectedSource?: string;
  now?: Date;
}): MarketingAnalytics {
  const now = input.now ?? new Date();
  const cutoff = cutoffForRange(input.range, now);
  const contactById = new Map(
    input.contacts.map((contact) => [contact.id, contact]),
  );
  const leadSource = (lead: MarketingLead) =>
    sourceKey(
      contactById.get(lead.contact_id)?.source ?? lead.source_event_type,
    );
  const selectedSource =
    input.selectedSource && input.selectedSource !== "all"
      ? input.selectedSource
      : null;
  const rangeLeads = input.leads.filter(
    (lead) =>
      inRange(lead.created_at, cutoff, now) &&
      (!selectedSource || leadSource(lead) === selectedSource),
  );
  const rangeContactIds = new Set(rangeLeads.map((lead) => lead.contact_id));
  const rangeAppointments = input.appointments.filter((appointment) => {
    if (!inRange(appointment.created_at, cutoff, now)) return false;
    if (selectedSource) {
      const contact = appointment.contact_id
        ? contactById.get(appointment.contact_id)
        : null;
      return sourceKey(contact?.source) === selectedSource;
    }
    return (
      !appointment.contact_id || rangeContactIds.has(appointment.contact_id)
    );
  });
  const rangeFeedback = input.feedback.filter((item) =>
    inRange(item.created_at, cutoff, now),
  );
  const wonLeads = rangeLeads.filter((lead) => lead.status === "won");
  const bookedAppointments = rangeAppointments.filter((appointment) =>
    ["booked", "completed"].includes(appointment.status),
  );
  const ratedFeedback = rangeFeedback.filter(
    (item) => item.rating !== null,
  );
  const sourceKeys = [
    ...new Set(
      input.leads
        .filter((lead) => inRange(lead.created_at, cutoff, now))
        .map(leadSource),
    ),
  ].sort((a, b) =>
    marketingSourceLabel(a).localeCompare(marketingSourceLabel(b)),
  );
  const sources = sourceKeys
    .map((source): MarketingSourcePerformance => {
      const leads = rangeLeads.filter((lead) => leadSource(lead) === source);
      const leadContactIds = new Set(leads.map((lead) => lead.contact_id));
      const appointments = rangeAppointments.filter(
        (appointment) =>
          appointment.contact_id &&
          leadContactIds.has(appointment.contact_id) &&
          ["booked", "completed"].includes(appointment.status),
      );
      const won = leads.filter((lead) => lead.status === "won");

      return {
        source,
        label: marketingSourceLabel(source),
        leads: leads.length,
        appointments: appointments.length,
        won: won.length,
        conversionRate:
          leads.length > 0 ? Math.round((won.length / leads.length) * 100) : 0,
        estimatedRevenue: won.reduce(
          (sum, lead) => sum + estimatedLeadValue(lead),
          0,
        ),
      };
    })
    .filter((source) => !selectedSource || source.source === selectedSource)
    .sort(
      (a, b) =>
        b.estimatedRevenue - a.estimatedRevenue || b.leads - a.leads,
    );

  const periodStart =
    cutoff ??
    Math.min(
      ...rangeLeads.map((lead) => timestamp(lead.created_at)),
      now.getTime(),
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
    const bucketLeads = rangeLeads.filter((lead) => {
      const created = timestamp(lead.created_at);
      return created >= start && created < end;
    });

    return {
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
      }).format(new Date(start)),
      leads: bucketLeads.length,
      won: bucketLeads.filter((lead) => lead.status === "won").length,
    };
  });
  const topSource = sources[0];
  const highRiskReviewCount = rangeFeedback.filter((item) =>
    ["high", "urgent"].includes(item.risk_level),
  ).length;
  const averageRating =
    ratedFeedback.length > 0
      ? ratedFeedback.reduce((sum, item) => sum + (item.rating ?? 0), 0) /
        ratedFeedback.length
      : null;
  const insights: string[] = [];

  if (topSource) {
    insights.push(
      `${topSource.label} is the leading attributed source with ${topSource.leads} lead${topSource.leads === 1 ? "" : "s"} and ${topSource.conversionRate}% conversion.`,
    );
  }
  if (highRiskReviewCount > 0) {
    insights.push(
      `${highRiskReviewCount} high-risk review${highRiskReviewCount === 1 ? " needs" : "s need"} follow-up.`,
    );
  }
  if (averageRating !== null) {
    insights.push(
      `Average customer rating is ${averageRating.toFixed(1)} across ${ratedFeedback.length} rated review${ratedFeedback.length === 1 ? "" : "s"}.`,
    );
  }

  return {
    leadCount: rangeLeads.length,
    appointmentCount: bookedAppointments.length,
    wonCount: wonLeads.length,
    conversionRate:
      rangeLeads.length > 0
        ? Math.round((wonLeads.length / rangeLeads.length) * 100)
        : 0,
    estimatedRevenue: wonLeads.reduce(
      (sum, lead) => sum + estimatedLeadValue(lead),
      0,
    ),
    averageRating,
    reviewCount: rangeFeedback.length,
    highRiskReviewCount,
    positiveReviewCount: rangeFeedback.filter(
      (item) => item.sentiment === "positive",
    ).length,
    negativeReviewCount: rangeFeedback.filter(
      (item) => item.sentiment === "negative",
    ).length,
    availableSources: sourceKeys.map((source) => ({
      value: source,
      label: marketingSourceLabel(source),
    })),
    sources,
    trend,
    funnel: [
      { label: "Leads", value: rangeLeads.length },
      {
        label: "Contacted",
        value: rangeLeads.filter((lead) => lead.status !== "new").length,
      },
      {
        label: "Quoted",
        value: rangeLeads.filter((lead) =>
          ["quoted", "scheduled", "won"].includes(lead.status),
        ).length,
      },
      { label: "Appointments", value: bookedAppointments.length },
      { label: "Won", value: wonLeads.length },
    ],
    recentFeedback: [...rangeFeedback]
      .sort((a, b) => timestamp(b.created_at) - timestamp(a.created_at))
      .slice(0, 6),
    insights,
  };
}
