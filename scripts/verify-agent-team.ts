import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { assignWork, checkFollowup, delegateWork } from "../lib/agents/store";
import { processAgentWork, scheduleAgentReviews } from "../lib/agents/runner";
import { agentDeliveryBlock } from "../lib/agents/delivery-guard";
import { readManagerChat } from "../lib/agents/manager-chat";
import { executeActionJob } from "../lib/jobs/execute";
import { createBusinessRecord } from "../lib/business/engine";
import type { WorkItem } from "../lib/agents/types";
import type { ActionJobRecord } from "../lib/jobs/record";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local verification only",
  );
  delete process.env.ANTHROPIC_API_KEY;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const unwrap = <T>(r: {
    data: T;
    error: { message: string } | null;
  }): NonNullable<T> => {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  };
  const login = await owner.auth.signInWithPassword({
    email: "client@northstar.test",
    password: "local-password-change-me",
  });
  if (login.error) throw login.error;
  const actorId = login.data.user.id;
  const partnerId = randomUUID(),
    clientId = randomUUID(),
    otherId = randomUUID();
  const scope = { partnerId, clientId };
  const future = () => new Date(Date.now() + 3_600_000).toISOString();
  const old = new Date(Date.now() - 3 * 86400000).toISOString();
  const row = async (id: string): Promise<WorkItem> =>
    unwrap(
      await admin.from("agent_work_items").select("*").eq("id", id).single(),
    );
  async function isolate(id: string) {
    unwrap(
      await admin
        .from("agent_work_items")
        .update({ next_run_at: future() })
        .eq("client_id", clientId),
    );
    unwrap(
      await admin
        .from("agent_work_items")
        .update({ next_run_at: old })
        .eq("id", id),
    );
  }
  async function claim(id: string): Promise<WorkItem> {
    await isolate(id);
    const claimed = unwrap(
      await admin.rpc("claim_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
      }),
    );
    assert.equal(claimed?.[0]?.id, id);
    return claimed![0];
  }
  async function run(id: string) {
    await isolate(id);
    await processAgentWork(admin, 1, scope);
    return row(id);
  }
  async function lead(contactId?: string) {
    const contact = contactId
      ? unwrap(
          await admin
            .from("crm_contacts")
            .select("*")
            .eq("id", contactId)
            .single(),
        )
      : unwrap(
          await admin
            .from("crm_contacts")
            .insert({
              partner_id: partnerId,
              client_id: clientId,
              first_name: "Verification",
              email: `verify-${randomUUID()}@example.invalid`,
              created_at: old,
              updated_at: old,
            })
            .select()
            .single(),
        );
    const leadRow = unwrap(
      await admin
        .from("crm_leads")
        .insert({
          partner_id: partnerId,
          client_id: clientId,
          contact_id: contact.id,
          title: "Verification inquiry",
          created_at: old,
          updated_at: old,
        })
        .select()
        .single(),
    );
    return { contact, lead: leadRow };
  }
  async function followup(context: Awaited<ReturnType<typeof lead>>) {
    return assignWork(admin, scope, {
      kind: "lead_follow_up",
      title: "Verification follow-up",
      key: `verify:${randomUUID()}`,
      leadId: context.lead.id,
      input: {
        lead_updated_at: context.lead.updated_at,
        contact_updated_at: context.contact.updated_at,
        evaluated_at: new Date(Date.now() - 1000).toISOString(),
      },
    });
  }
  const propose = (work: WorkItem) =>
    admin.rpc("propose_agent_followup", {
      p_work: work.id,
      p_claim: work.claim_token,
      p_channel: "email",
      p_subject: "Verification only",
      p_body: "TEST DRAFT — fixture, not model output.",
    });
  unwrap(
    await admin.from("partners").insert({
      id: partnerId,
      name: "Agent verification",
      slug: `verify-${partnerId}`,
      is_test_account: true,
      status: "active",
    }),
  );
  try {
    unwrap(
      await admin.from("client_businesses").insert(
        [clientId, otherId].map((id) => ({
          id,
          partner_id: partnerId,
          name: "Isolated agent verification",
          client_portal_enabled: true,
          slug: `verify-${id}`,
          is_test_account: true,
          status: "active",
        })),
      ),
    );
    unwrap(
      await admin.from("memberships").insert({
        user_id: actorId,
        partner_id: partnerId,
        client_id: clientId,
        role: "client_owner",
        status: "active",
      }),
    );
    unwrap(
      await admin.from("agent_team_settings").insert(
        [clientId, otherId].map((id) => ({
          client_id: id,
          partner_id: partnerId,
          status: "active",
          sales_enabled: true,
          operations_enabled: true,
        })),
      ),
    );

    const foreign = await assignWork(
      admin,
      { partnerId, clientId: otherId },
      {
        kind: "owner_briefing",
        title: "Foreign assignment",
        key: randomUUID(),
      },
    );
    assert.equal(
      unwrap(
        await owner.from("agent_work_items").select("id").eq("id", foreign),
      )?.length,
      0,
    );
    assert.ok(
      (
        await owner
          .from("agent_team_settings")
          .update({ status: "paused" })
          .eq("client_id", clientId)
      ).error,
    );
    assert.ok(
      (
        await owner.rpc("claim_agent_work", {
          p_partner: partnerId,
          p_client: clientId,
        })
      ).error,
    );
    const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    assert.ok((await anon.from("agent_work_items").select("id")).error);
    await assert.rejects(() =>
      assignWork(admin, scope, {
        kind: "owner_briefing",
        title: "Invalid parent",
        key: randomUUID(),
        parentId: foreign,
      }),
    );

    const request = {
      kind: "owner_briefing" as const,
      title: "Idempotent briefing",
      key: randomUUID(),
    };
    const ids = await Promise.all([
      assignWork(admin, scope, request),
      assignWork(admin, scope, request),
    ]);
    assert.equal(ids[0], ids[1]);
    assert.equal(
      unwrap(await owner.from("agent_work_items").select("id").eq("id", ids[0]))
        ?.length,
      1,
    );
    await isolate(ids[0]);
    const claims = await Promise.all([
      admin.rpc("claim_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
      }),
      admin.rpc("claim_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
      }),
    ]);
    assert.equal(
      claims.map(unwrap).filter((r) => r?.length).length,
      1,
      "Only one worker claims an assignment",
    );
    const initialClaim = await row(ids[0]);
    unwrap(
      await admin
        .from("agent_work_items")
        .update({ lease_until: old })
        .eq("id", ids[0]),
    );
    const recovered = await claim(ids[0]);
    assert.notEqual(recovered.claim_token, initialClaim.claim_token);
    assert.equal(
      unwrap(
        await admin.rpc("finish_agent_work", {
          p_id: ids[0],
          p_claim: initialClaim.claim_token,
          p_status: "completed",
          p_summary: "Stale result",
        }),
      ),
      false,
    );
    unwrap(
      await admin.rpc("finish_agent_work", {
        p_id: ids[0],
        p_claim: recovered.claim_token,
        p_status: "completed",
        p_summary: "Recovery verified",
      }),
    );

    const root = await assignWork(admin, scope, {
      kind: "business_request",
      title: "Atomic delegation",
      key: randomUUID(),
    });
    const rootClaim = await claim(root);
    const firstChildKey = randomUUID();
    await assert.rejects(() =>
      delegateWork(
        admin,
        rootClaim,
        [
          {
            kind: "sales_review",
            title: "Valid first child",
            key: firstChildKey,
          },
          {
            kind: "lead_follow_up",
            title: "Forbidden child",
            key: randomUUID(),
          },
        ],
        "Invalid plan",
      ),
    );
    assert.equal(
      unwrap(
        await admin.from("agent_work_items").select("id").eq("parent_id", root),
      )?.length,
      0,
      "Failed delegation rolls every child back",
    );
    await delegateWork(
      admin,
      rootClaim,
      [{ kind: "owner_briefing", title: "Saved child", key: firstChildKey }],
      "Valid plan",
    );
    const delegated = unwrap(
      await admin
        .from("agent_work_items")
        .select("*")
        .eq("parent_id", root)
        .single(),
    );
    const parent = await row(root);
    unwrap(
      await admin.rpc("control_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
        p_id: root,
        p_revision: parent.revision,
        p_action: "cancel",
      }),
    );
    assert.equal((await row(delegated.id)).status, "cancelled");
    await assert.rejects(() =>
      assignWork(admin, scope, {
        kind: "owner_briefing",
        title: "Late child",
        key: randomUUID(),
        parentId: root,
      }),
    );

    const salesContext = await lead();
    const sales = await assignWork(admin, scope, {
      kind: "sales_review",
      title: "Sales review",
      key: randomUUID(),
    });
    assert.equal((await run(sales)).status, "waiting_children");
    const child = unwrap(
      await admin
        .from("agent_work_items")
        .select("*")
        .eq("source_lead_id", salesContext.lead.id)
        .single(),
    );
    assert.equal(
      (await run(child.id)).status,
      "blocked",
      "Missing model must not fabricate a draft",
    );
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("id")
          .eq("client_id", clientId),
      )?.length,
      0,
    );
    const sales2 = await assignWork(admin, scope, {
      kind: "sales_review",
      title: "Repeated review",
      key: randomUUID(),
    });
    await run(sales2);
    assert.equal(
      unwrap(
        await admin
          .from("agent_work_items")
          .select("id")
          .eq("source_lead_id", salesContext.lead.id),
      )?.length,
      1,
    );
    const noModelPlan = await assignWork(admin, scope, {
      kind: "business_request",
      title: "Model unavailable",
      key: randomUUID(),
      input: { request: "Check sales" },
    });
    assert.equal((await run(noModelPlan)).status, "blocked");
    const basicStatus = await assignWork(admin, scope, {
      kind: "business_request",
      title: "What needs my attention?",
      key: randomUUID(),
      input: { request: "What needs my attention?" },
    });
    const statusAnswer = await run(basicStatus);
    assert.equal(statusAnswer.status, "completed");
    assert.match(statusAnswer.summary, /pending approvals/);
    const basicReview = await assignWork(admin, scope, {
      kind: "business_request",
      title: "Review leads",
      key: randomUUID(),
      input: { request: "Review leads" },
    });
    assert.equal((await run(basicReview)).status, "waiting_children");
    const chat = await readManagerChat(admin, scope, true);
    assert.equal(chat.active, true);
    assert.equal(chat.aiConfigured, false);
    assert.equal(chat.messages.find((message) => message.id === basicStatus)?.status, "completed");
    assert.equal(chat.messages.find((message) => message.id === basicReview)?.assignments.length, 1);
    assert.equal(chat.messages.find((message) => message.id === noModelPlan)?.request, "Check sales");
    assert.equal(chat.messages.find((message) => message.id === noModelPlan)?.status, "blocked");
    assert.ok(chat.messages.find((message) => message.id === root)?.assignments.length);
    const otherChat = await readManagerChat(admin, { partnerId, clientId: otherId }, false);
    assert.equal(otherChat.messages.some((message) => message.id === noModelPlan), false);

    const messageContext = await lead();
    const messageWork = await followup(messageContext);
    const messageClaim = await claim(messageWork);
    const approvalId = unwrap(await propose(messageClaim));
    assert.equal((await row(messageWork)).approval_id, approvalId);
    assert.ok(
      (await propose(messageClaim)).error,
      "A replay cannot create a second approval",
    );
    unwrap(
      await admin
        .from("approval_items")
        .update({ status: "approved", resolved_by: actorId })
        .eq("id", approvalId),
    );
    const job = unwrap(
      await admin
        .from("action_jobs")
        .select("*")
        .eq("approval_id", approvalId)
        .single(),
    ) as ActionJobRecord;
    assert.equal(job.payload.agent_work_id, messageWork);
    assert.equal(await agentDeliveryBlock(admin, job), null);
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ status: "paused" })
        .eq("client_id", clientId),
    );
    assert.match((await agentDeliveryBlock(admin, job))!, /paused/);
    const stoppedDelivery = await executeActionJob(admin, job);
    assert.equal(
      stoppedDelivery.attempted,
      false,
      "Paused agent cannot reach a delivery provider",
    );
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ status: "active" })
        .eq("client_id", clientId),
    );
    unwrap(
      await admin.from("crm_communications").insert({
        partner_id: partnerId,
        client_id: clientId,
        contact_id: messageContext.contact.id,
        lead_id: messageContext.lead.id,
        channel: "email",
        direction: "inbound",
        body: "I already booked elsewhere.",
      }),
    );
    assert.match(
      (await checkFollowup(admin, messageWork)).reason,
      /conversation activity/,
    );
    assert.equal((await executeActionJob(admin, job)).attempted, false);
    // Simulate recorded provider outcomes, without calling any provider.
    unwrap(
      await admin
        .from("action_jobs")
        .update({ status: "uncertain" })
        .eq("id", job.id),
    );
    assert.equal((await run(messageWork)).status, "blocked");
    const uncertain = await row(messageWork);
    unwrap(
      await admin.rpc("control_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
        p_id: messageWork,
        p_revision: uncertain.revision,
        p_action: "retry",
      }),
    );
    unwrap(
      await admin
        .from("action_jobs")
        .update({
          status: "succeeded",
          external_ref: "TEST-PROVIDER-ACCEPTANCE",
        })
        .eq("id", job.id),
    );
    assert.equal((await run(messageWork)).status, "completed");

    const changedContext = await lead();
    const changed = await followup(changedContext);
    unwrap(
      await admin
        .from("crm_leads")
        .update({ status: "won" })
        .eq("id", changedContext.lead.id),
    );
    assert.equal((await checkFollowup(admin, changed)).allowed, false);
    const optedContext = await lead();
    const opted = await followup(optedContext);
    unwrap(
      await admin.from("crm_communications").insert({
        partner_id: partnerId,
        client_id: clientId,
        contact_id: optedContext.contact.id,
        channel: "sms",
        direction: "inbound",
        body: "STOP",
        occurred_at: old,
      }),
    );
    assert.match((await checkFollowup(admin, opted)).reason, /opt-out/);

    const concurrentContext = await lead();
    const concurrentContext2 = await lead(concurrentContext.contact.id);
    const concurrentA = await followup(concurrentContext),
      concurrentB = await followup(concurrentContext2);
    const claimA = await claim(concurrentA),
      claimB = await claim(concurrentB);
    const proposals = await Promise.all([propose(claimA), propose(claimB)]);
    assert.equal(
      proposals.filter((r) => !r.error).length,
      1,
      "One pending agent message per customer under concurrency",
    );

    const product = await createBusinessRecord(
      admin,
      { ...scope, actorId },
      {
        kind: "product",
        title: "Verification stock",
        body: "",
        data: {
          quantity: 2,
          reorder_point: 4,
          target_stock: 12,
          unit_cost: 5,
          price: 10,
        },
      },
      randomUUID(),
    );
    const operations = await assignWork(admin, scope, {
      kind: "operations_review",
      title: "Review stock",
      key: randomUUID(),
    });
    assert.equal((await run(operations)).status, "waiting_children");
    const purchaseWork = unwrap(
      await admin
        .from("agent_work_items")
        .select("*")
        .eq("source_record_id", product)
        .single(),
    );
    const prepared = await run(purchaseWork.id);
    assert.equal(prepared.status, "waiting_approval");
    const purchaseId = prepared.result_record_id!;
    let purchase = unwrap(
      await admin
        .from("business_records")
        .select("*")
        .eq("id", purchaseId)
        .single(),
    );
    assert.equal(purchase.data.quantity, 10);
    async function transition(action: string, reference = "") {
      purchase = unwrap(
        await admin
          .from("business_records")
          .select("*")
          .eq("id", purchaseId)
          .single(),
      );
      return admin.rpc("transition_business_record", {
        p_partner: partnerId,
        p_client: clientId,
        p_actor: actorId,
        p_id: purchaseId,
        p_revision: purchase.revision,
        p_action: action,
        p_reference: reference,
      });
    }
    unwrap(await transition("approve"));
    assert.equal(
      (await run(purchaseWork.id)).status,
      "waiting_external",
      "Approval is not an order or receipt",
    );
    assert.ok((await transition("receive")).error);
    unwrap(await transition("order", "TEST-ORDER-REFERENCE"));
    assert.equal((await run(purchaseWork.id)).status, "waiting_external");
    unwrap(await transition("receive"));
    assert.equal((await run(purchaseWork.id)).status, "completed");
    assert.equal(
      unwrap(
        await admin
          .from("business_records")
          .select("data")
          .eq("id", product)
          .single(),
      ).data.quantity,
      12,
    );
    assert.ok(
      (await transition("receive")).error,
      "Repeated receipt cannot add inventory twice",
    );
    assert.equal((await run(operations)).status, "completed");
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ scheduled_reviews: true, next_review_at: old })
        .eq("client_id", clientId),
    );
    await Promise.all([
      scheduleAgentReviews(admin, 1, scope),
      scheduleAgentReviews(admin, 1, scope),
    ]);
    assert.equal(
      unwrap(
        await admin
          .from("agent_work_items")
          .select("id")
          .eq("client_id", clientId)
          .like("dedupe_key", "schedule:%"),
      ).length,
      3,
      "Concurrent schedule ticks create one assignment per department",
    );
    const schedule = unwrap(
      await admin
        .from("agent_team_settings")
        .select("next_review_at")
        .eq("client_id", clientId)
        .single(),
    );
    assert.ok(Date.parse(schedule.next_review_at) > Date.now() + 3500000);
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ status: "paused", next_review_at: old })
        .eq("client_id", clientId),
    );
    assert.equal((await scheduleAgentReviews(admin, 1, scope)).scheduled, 0);
    console.log(
      "PASS: scoped persistence, RLS, concurrent claims, lease recovery, atomic delegation, cancellation, real CRM review, missing AI, immutable approval/outbox, reply and pause delivery guards, opt-outs, concurrent proposals, purchasing approval/order/receipt, and manager completion. No live provider calls.",
    );
  } finally {
    // All fixtures are isolated in these two newly created local businesses.
    unwrap(
      await admin
        .from("agent_work_items")
        .delete()
        .in("client_id", [clientId, otherId]),
    );
    unwrap(
      await admin
        .from("business_workspace_events")
        .delete()
        .eq("client_id", clientId),
    );
    unwrap(
      await admin.from("business_records").delete().eq("client_id", clientId),
    );
    unwrap(await admin.from("action_jobs").delete().eq("client_id", clientId));
    unwrap(
      await admin.from("approval_items").delete().eq("client_id", clientId),
    );
    unwrap(
      await admin
        .from("client_businesses")
        .delete()
        .in("id", [clientId, otherId]),
    );
    unwrap(await admin.from("partners").delete().eq("id", partnerId));
    await owner.auth.signOut({ scope: "local" });
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.stack : "Verification failed");
  process.exitCode = 1;
});
