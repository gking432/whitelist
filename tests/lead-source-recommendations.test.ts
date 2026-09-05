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

test("managed Twilio is an available native path for phone calls", () => {
  const plan = recommendSetupPlan(
    answers({
      leadSources: ["phone_calls"],
      hasPhoneProvider: "yes",
    }),
  );
  const native = plan.sources[0]?.paths.find(
    (path) => path.path === "native_connection",
  );

  assert.equal(native?.status, "available_now");
  assert.equal(native?.recommended, true);
  assert.match(native?.howItWorksToday ?? "", /managed Twilio number/);
  assert.ok(
    plan.stackNotes.some((note) =>
      note.includes("native AI answering and live scheduling assistance"),
    ),
  );
});

test("manual entry opens the real built-in CRM lead form", () => {
  const plan = recommendSetupPlan(
    answers({ leadSources: ["manual_entry"] }),
  );
  const manual = plan.sources[0]?.paths.find(
    (path) => path.path === "manual_entry",
  );

  assert.equal(manual?.status, "available_now");
  assert.equal(manual?.recommended, true);
  assert.deepEqual(manual?.action, {
    label: "Add a lead",
    hrefSuffix: "/crm?view=pipeline&new=1",
  });
  assert.match(manual?.howItWorksToday ?? "", /built-in CRM pipeline/);
});

test("Google Business Profile lead intake stays honest without a direct lead API", () => {
  const plan = recommendSetupPlan(
    answers({ leadSources: ["google_business_profile"] }),
  );
  const native = plan.sources[0]?.paths.find(
    (path) => path.path === "native_connection",
  );

  assert.equal(native?.status, "coming_soon");
  assert.equal(native?.action, null);
});
