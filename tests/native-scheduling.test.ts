import assert from "node:assert/strict";
import test from "node:test";

import { resolveSchedulingProvider } from "../lib/scheduling/provider.ts";

test("built-in CRM uses the native calendar without Google", () => {
  assert.equal(
    resolveSchedulingProvider({
      hasGoogleCalendar: false,
      crmOperatingMode: "primary_crm",
    }),
    "northstar_internal",
  );
});

test("connected Google Calendar remains the preferred scheduling provider", () => {
  assert.equal(
    resolveSchedulingProvider({
      hasGoogleCalendar: true,
      crmOperatingMode: "primary_crm",
    }),
    "google_calendar",
  );
});

test("connected Microsoft 365 calendar is selected for scheduling", () => {
  assert.equal(
    resolveSchedulingProvider({
      hasGoogleCalendar: true,
      externalProvider: "microsoft_365",
      crmOperatingMode: "primary_crm",
    }),
    "microsoft_365",
  );
});

test("external CRM mode requires a calendar connection", () => {
  assert.equal(
    resolveSchedulingProvider({
      hasGoogleCalendar: false,
      crmOperatingMode: "external_crm",
    }),
    null,
  );
});
