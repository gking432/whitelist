import assert from "node:assert/strict";
import test from "node:test";

import {
  partnerSlugBase,
  validateNewPartnerFields,
} from "../lib/control/partner-provisioning.ts";

test("partner provisioning creates a stable slug", () => {
  assert.equal(
    partnerSlugBase("  Acme Home Services! "),
    "acme-home-services",
  );
});

test("partner provisioning requires the agency and owner identity", () => {
  assert.deepEqual(
    validateNewPartnerFields({
      agencyName: "",
      ownerName: "",
      ownerEmail: "invalid",
    }),
    {
      agency_name: "Agency name is required.",
      owner_name: "Owner name is required.",
      owner_email: "Enter a valid owner email.",
    },
  );
});

test("partner provisioning accepts a complete invitation", () => {
  assert.deepEqual(
    validateNewPartnerFields({
      agencyName: "Acme Home Services",
      ownerName: "Alex Owner",
      ownerEmail: "alex@example.com",
    }),
    {},
  );
});
