import assert from "node:assert/strict";
import test from "node:test";

import type { IntakeAnswers } from "../lib/lead-sources/catalog.ts";
import { recommendSetupPlan } from "../lib/lead-sources/recommend.ts";

function answers(overrides: Partial<IntakeAnswers>): IntakeAnswers {
  return {
    leadSources: ["website_chat"],
    websitePlatform: "none",
    canEditWebsite: "unsure",
    hasCrm: "no",
    hasPhoneProvider: "no",
    hasMessagingProvider: "no",
    hasCalendar: "no",
    ...overrides,
  };
}

test("website chat recommends the hosted page when the client has no site", () => {
  const plan = recommendSetupPlan(answers({}));
  const hosted = plan.sources[0]?.paths.find(
    (path) => path.path === "hosted_page",
  );

  assert.equal(hosted?.status, "available_now");
  assert.equal(hosted?.recommended, true);
  assert.equal(hosted?.action?.label, "Set up website chat");
  assert.match(hosted?.howItWorksToday ?? "", /hosted chat URL/);
  assert.ok(plan.stackNotes.some((note) => note.includes("built-in CRM now")));
});

test("website chat recommends the embed when the site can be edited", () => {
  const plan = recommendSetupPlan(
    answers({ websitePlatform: "wordpress", canEditWebsite: "yes" }),
  );
  const snippet = plan.sources[0]?.paths.find(
    (path) => path.path === "website_snippet",
  );

  assert.equal(snippet?.status, "available_now");
  assert.equal(snippet?.recommended, true);
  assert.match(snippet?.howItWorksToday ?? "", /iframe snippet/);
});

test("Twilio is an available native path for text-message intake", () => {
  const plan = recommendSetupPlan(
    answers({ leadSources: ["sms"], websitePlatform: "unknown" }),
  );
  const native = plan.sources[0]?.paths.find(
    (path) => path.path === "native_connection",
  );

  assert.equal(native?.status, "available_now");
  assert.equal(native?.recommended, true);
  assert.match(native?.howItWorksToday ?? "", /Twilio SMS/);
});
