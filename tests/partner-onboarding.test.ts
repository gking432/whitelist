import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPlanPrice,
  furthestOnboardingStep,
  partnerOnboardingIsComplete,
  partnerTwilioConnectionIsReady,
  PARTNER_V1_PLAN,
  requestedOnboardingStep,
} from "../lib/onboarding/partner.ts";

test("partner v1 plan preserves the agreed launch pricing", () => {
  assert.equal(PARTNER_V1_PLAN.setupFeeCents, 100_000);
  assert.equal(PARTNER_V1_PLAN.monthlyFeeCents, 50_000);
  assert.equal(PARTNER_V1_PLAN.includedActiveClients, 10);
  assert.equal(PARTNER_V1_PLAN.additionalClientFeeCents, null);
  assert.equal(formatPlanPrice(PARTNER_V1_PLAN.monthlyFeeCents), "$500");
});

test("unfinished partners cannot skip ahead in onboarding", () => {
  assert.equal(requestedOnboardingStep("plan", "team", false), "team");
  assert.equal(requestedOnboardingStep("agency", "team", false), "agency");
  assert.equal(requestedOnboardingStep("integrations", "team", false), "team");
});

test("saved progress never moves backward", () => {
  assert.equal(furthestOnboardingStep("integrations", "branding"), "integrations");
  assert.equal(furthestOnboardingStep("team", "plan"), "plan");
});

test("onboarding requires both completed status and timestamp", () => {
  assert.equal(
    partnerOnboardingIsComplete({
      status: "completed",
      completed_at: "2026-07-26T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    partnerOnboardingIsComplete({
      status: "completed",
      completed_at: null,
    }),
    false,
  );
  assert.equal(partnerOnboardingIsComplete(null), false);
});

test("partner onboarding requires a recently verified Twilio parent account", () => {
  assert.equal(
    partnerTwilioConnectionIsReady({
      status: "connected",
      credential_status: "configured",
      last_success_at: "2026-08-11T12:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    partnerTwilioConnectionIsReady({
      status: "connected",
      credential_status: "missing",
      last_success_at: "2026-08-11T12:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    partnerTwilioConnectionIsReady({
      status: "needs_attention",
      credential_status: "configured",
      last_success_at: "2026-08-11T12:00:00.000Z",
    }),
    false,
  );
  assert.equal(partnerTwilioConnectionIsReady(null), false);
});
