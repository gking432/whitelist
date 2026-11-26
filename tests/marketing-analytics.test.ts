import assert from "node:assert/strict";
import test from "node:test";

import { buildMarketingAnalytics } from "../lib/crm/marketing-analytics.ts";

const now = new Date("2026-07-25T12:00:00.000Z");
const contacts = [
  {
    id: "contact-google",
    source: "google_ads",
    created_at: "2026-07-02T12:00:00.000Z",
  },
  {
    id: "contact-referral",
    source: "referral",
    created_at: "2026-07-05T12:00:00.000Z",
  },
];
const leads = [
  {
    id: "lead-google",
    contact_id: "contact-google",
    status: "won",
    source_event_type: "website_form",
    estimated_value_min: 8000,
    estimated_value_max: 12000,
    created_at: "2026-07-03T12:00:00.000Z",
  },
  {
    id: "lead-referral",
    contact_id: "contact-referral",
    status: "quoted",
    source_event_type: "manual",
    estimated_value_min: 4000,
    estimated_value_max: 6000,
    created_at: "2026-07-06T12:00:00.000Z",
  },
];
const appointments = [
  {
    id: "appointment-google",
    contact_id: "contact-google",
    status: "completed",
    created_at: "2026-07-04T12:00:00.000Z",
  },
];
const feedback = [
  {
    id: "review-1",
    source: "google_review",
    rating: 5,
    sentiment: "positive",
    risk_level: "low",
    summary: "Excellent communication.",
    created_at: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "review-2",
    source: "survey",
    rating: 2,
    sentiment: "negative",
    risk_level: "high",
    summary: "Scheduling communication needs attention.",
    created_at: "2026-07-11T12:00:00.000Z",
  },
];

test("marketing analytics attributes leads, appointments, and revenue", () => {
  const analytics = buildMarketingAnalytics({
    contacts,
    leads,
    appointments,
    feedback,
    range: "30d",
    now,
  });

  assert.equal(analytics.leadCount, 2);
  assert.equal(analytics.appointmentCount, 1);
  assert.equal(analytics.wonCount, 1);
  assert.equal(analytics.conversionRate, 50);
  assert.equal(analytics.estimatedRevenue, 10000);
  assert.equal(analytics.sources[0]?.source, "google_ads");
  assert.equal(analytics.sources[0]?.conversionRate, 100);
});

test("source filter limits acquisition results without hiding reputation", () => {
  const analytics = buildMarketingAnalytics({
    contacts,
    leads,
    appointments,
    feedback,
    range: "30d",
    selectedSource: "referral",
    now,
  });

  assert.equal(analytics.leadCount, 1);
  assert.equal(analytics.wonCount, 0);
  assert.equal(analytics.sources.length, 1);
  assert.equal(analytics.sources[0]?.source, "referral");
  assert.equal(analytics.reviewCount, 2);
});

test("reputation metrics use only real feedback in the date range", () => {
  const analytics = buildMarketingAnalytics({
    contacts,
    leads,
    appointments,
    feedback: [
      ...feedback,
      {
        ...feedback[0],
        id: "old-review",
        created_at: "2025-01-01T12:00:00.000Z",
      },
    ],
    range: "30d",
    now,
  });

  assert.equal(analytics.reviewCount, 2);
  assert.equal(analytics.averageRating, 3.5);
  assert.equal(analytics.highRiskReviewCount, 1);
  assert.equal(analytics.positiveReviewCount, 1);
  assert.equal(analytics.negativeReviewCount, 1);
});

test("empty activity returns zero metrics without sample data", () => {
  const analytics = buildMarketingAnalytics({
    contacts: [],
    leads: [],
    appointments: [],
    feedback: [],
    range: "90d",
    now,
  });

  assert.equal(analytics.leadCount, 0);
  assert.equal(analytics.estimatedRevenue, 0);
  assert.equal(analytics.averageRating, null);
  assert.deepEqual(analytics.sources, []);
  assert.deepEqual(analytics.insights, []);
});
