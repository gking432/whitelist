import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPilotAppUrl,
  selectFullPilotClient,
} from "../lib/control/pilot.ts";

test("the pilot chooses the test client with the broadest package", () => {
  const selected = selectFullPilotClient(
    [
      {
        id: "lead-only",
        partnerId: "partner",
        name: "Scenario Lab",
        isTestAccount: true,
        packageId: "small",
      },
      {
        id: "full",
        partnerId: "partner",
        name: "Full Pilot",
        isTestAccount: true,
        packageId: "large",
      },
      {
        id: "real",
        partnerId: "partner",
        name: "Real Client",
        isTestAccount: false,
        packageId: "large",
      },
    ],
    [
      { id: "small", name: "Small", capabilities: { lead_intake: true } },
      {
        id: "large",
        name: "Large",
        capabilities: {
          lead_intake: true,
          crm_sync: true,
          message_drafting: true,
        },
      },
    ],
  );

  assert.equal(selected?.client.id, "full");
  assert.equal(selected?.capabilityKeys.length, 3);
});

test("pilot URLs must be stable public HTTPS addresses", () => {
  assert.equal(classifyPilotAppUrl("http://localhost:3000").ready, false);
  assert.equal(
    classifyPilotAppUrl("https://example.trycloudflare.com").ready,
    false,
  );
  assert.equal(classifyPilotAppUrl("https://app.example.com").ready, true);
});
