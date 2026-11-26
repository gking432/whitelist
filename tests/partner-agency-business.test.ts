import assert from "node:assert/strict";
import test from "node:test";

import { ensurePartnerAgencyBusiness } from "../lib/partners/agency-business.ts";

function query(result: unknown) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
    single: async () => result,
  };
  return chain;
}

test("agency workspace creation returns the concurrent winner", async () => {
  let reads = 0;
  const winner = {
    id: "agency-1",
    name: "Partner Agency",
    slug: "partner-agency",
  };
  const admin = {
    from(table: string) {
      if (table === "partners") {
        return query({
          data: {
            name: "Partner Agency",
            slug: "partner",
            is_test_account: false,
          },
          error: null,
        });
      }
      if (table !== "client_businesses") throw new Error("Unexpected table");

      reads += 1;
      if (reads === 1) return query({ data: null, error: null });
      if (reads === 2) {
        const insert = query({
          data: null,
          error: { code: "23505" },
        });
        return { ...insert, insert: () => insert };
      }
      return query({ data: winner, error: null });
    },
  };

  const result = await ensurePartnerAgencyBusiness(admin as never, {
    partnerId: "partner-1",
    userId: "user-1",
  });

  assert.deepEqual(result, winner);
});
