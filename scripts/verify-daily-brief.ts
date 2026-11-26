import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createBusinessRecord } from "../lib/business/engine";
import { validateGoalLink } from "../lib/business/record-links";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local verification only",
  );
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const partnerId = randomUUID(),
    clientId = randomUUID(),
    otherId = randomUUID();
  const scope = { partnerId, clientId, actorId: null };
  const check = <T>(result: {
    data: T;
    error: { message: string } | null;
  }): T => {
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  check(
    await admin.from("partners").insert({
      id: partnerId,
      name: "Disposable dashboard verification",
      slug: `verify-${partnerId}`,
      is_test_account: true,
      status: "active",
    }),
  );
  try {
    check(
      await admin.from("client_businesses").insert(
        [clientId, otherId].map((id) => ({
          id,
          partner_id: partnerId,
          name: "Disposable verification",
          slug: `verify-${id}`,
          is_test_account: true,
          status: "active",
        })),
      ),
    );
    const goal = {
      kind: "goal" as const,
      title: "Measured verification goal",
      body: "",
      data: { current: 0, target: 10, unit: "appointments", period: "monthly" },
    };
    const key = randomUUID();
    const goalId = await createBusinessRecord(admin, scope, goal, key);
    assert.equal(
      await createBusinessRecord(admin, scope, goal, key),
      goalId,
      "Retries cannot duplicate a goal",
    );
    const job = {
      kind: "job" as const,
      title: "Verification action",
      body: "",
      data: { goal_id: goalId, due_date: "2026-10-31" },
    };
    const jobId = await createBusinessRecord(admin, scope, job, randomUUID());
    await assert.rejects(
      () =>
        createBusinessRecord(
          admin,
          { ...scope, clientId: otherId },
          job,
          randomUUID(),
        ),
      /active goal from this business/,
    );
    await assert.rejects(
      () => validateGoalLink(admin, { ...scope, clientId: otherId }, job),
      /active goal from this business/,
    );
    check(
      await admin.rpc("edit_business_record", {
        p_partner: partnerId,
        p_client: clientId,
        p_actor: null,
        p_id: goalId,
        p_revision: 1,
        p_title: goal.title,
        p_body: "",
        p_data: { ...goal.data, current: 4 },
      }),
    );
    const current = check(
      await admin
        .from("business_records")
        .select("data,revision")
        .eq("client_id", clientId)
        .eq("id", goalId)
        .single(),
    );
    assert.ok(current);
    assert.equal(current.data.current, 4);
    assert.equal(current.revision, 2);
    const stale = await admin.rpc("edit_business_record", {
      p_partner: partnerId,
      p_client: clientId,
      p_actor: null,
      p_id: goalId,
      p_revision: 1,
      p_title: goal.title,
      p_body: "",
      p_data: goal.data,
    });
    assert.match(stale.error?.message || "", /Record changed/);
    for (const [revision, action] of [
      [1, "start"],
      [2, "complete"],
    ] as const)
      check(
        await admin.rpc("transition_business_record", {
          p_partner: partnerId,
          p_client: clientId,
          p_actor: null,
          p_id: jobId,
          p_revision: revision,
          p_action: action,
          p_reference: "",
        }),
      );
    const completed = check(
      await admin
        .from("business_records")
        .select("status,data")
        .eq("client_id", clientId)
        .eq("id", jobId)
        .single(),
    );
    assert.ok(completed);
    assert.equal(completed.status, "completed");
    assert.equal(completed.data.goal_id, goalId);
    console.log(
      "Verified: goal persistence, retry deduplication, linked actions, cross-client rejection, stale revisions, completion.",
    );
  } finally {
    check(
      await admin
        .from("business_workspace_events")
        .delete()
        .eq("partner_id", partnerId),
    );
    check(
      await admin.from("business_records").delete().eq("partner_id", partnerId),
    );
    check(
      await admin
        .from("client_businesses")
        .delete()
        .eq("partner_id", partnerId),
    );
    check(await admin.from("partners").delete().eq("id", partnerId));
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
});
