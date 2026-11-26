import { departmentOutput } from "../lib/agents/departments";
import { assignWork } from "../lib/agents/store";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { ingestMessage } from "../lib/conversations/store";
import { respondToConversation } from "../lib/conversations/agent";
import { processBookingRequest } from "../lib/conversations/booking";
import { conversationDeliveryBlock } from "../lib/conversations/delivery";
import { dispatchActionJob } from "../lib/jobs/dispatch";
async function executeActionJob(
  admin: Parameters<typeof dispatchActionJob>[0],
  job: ActionJobRecord,
) {
  const result = await dispatchActionJob(admin, job);
  assert.ok(result);
  return result;
}
import type { WorkItem } from "../lib/agents/types";
import type { ActionJobRecord } from "../lib/jobs/record";
import type { generateStructured } from "../lib/ai/provider";
async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  assert.ok(
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
    "Local isolated verification only",
  );
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const owner = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const anon = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  function unwrap<T>(r: {
    data: T;
    error: { message: string } | null;
  }): NonNullable<T> {
    if (r.error) throw new Error(r.error.message);
    return r.data as NonNullable<T>;
  }
  const partnerId = randomUUID(),
    clientId = randomUUID(),
    otherId = randomUUID(),
    scope = { partnerId, clientId };
  const login = await owner.auth.signInWithPassword({
    email: "client@northstar.test",
    password: "local-password-change-me",
  });
  if (login.error) throw login.error;
  const actor = login.data.user.id;
  const row = async (id: string) =>
    unwrap(
      await admin
        .from("business_conversations")
        .select("*")
        .eq("id", id)
        .single(),
    );
  const workrow = async (id: string) =>
    unwrap(
      await admin.from("agent_work_items").select("*").eq("id", id).single(),
    ) as WorkItem;
  async function claim(id: string) {
    unwrap(
      await admin
        .from("agent_work_items")
        .update({ next_run_at: new Date(Date.now() + 86400000).toISOString() })
        .eq("client_id", clientId),
    );
    unwrap(
      await admin
        .from("agent_work_items")
        .update({ next_run_at: new Date(0).toISOString() })
        .eq("id", id),
    );
    const rows = unwrap(
      await admin.rpc("claim_agent_work", {
        p_partner: partnerId,
        p_client: clientId,
      }),
    );
    assert.equal(rows[0]?.id, id);
    return rows[0] as WorkItem;
  }
  async function propose(
    cId: string,
    body = "TEST FIXTURE — approved website reply",
  ) {
    const c = await row(cId);
    return unwrap(
      await admin.rpc("propose_conversation_action", {
        p_partner: partnerId,
        p_client: clientId,
        p_id: cId,
        p_revision: c.revision,
        p_kind: "reply",
        p_body: body,
        p_actor: actor,
      }),
    ) as string;
  }
  async function approve(id: string) {
    const a = unwrap(
      await admin.from("approval_items").select("*").eq("id", id).single(),
    );
    unwrap(
      await admin
        .from("approval_items")
        .update({
          status: "approved",
          resolved_content: a.editable_content,
          resolved_by: actor,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", id),
    );
    return unwrap(
      await admin
        .from("action_jobs")
        .select("*")
        .eq("approval_id", id)
        .single(),
    ) as ActionJobRecord;
  }
  async function control(id: string, action: string, extra = {}) {
    const c = await row(id);
    unwrap(
      await admin.rpc("control_business_conversation", {
        p_partner: partnerId,
        p_client: clientId,
        p_id: id,
        p_revision: c.revision,
        p_action: action,
        p_actor: actor,
        ...extra,
      }),
    );
  }
  const fixtureModel =
    (
      plan: Record<string, unknown>,
      inspect?: (user: string) => void,
    ): typeof generateStructured =>
    async (args) => {
      inspect?.(args.user);
      return {
        data: args.schema.parse(plan),
        meta: {
          provider: "anthropic",
          model: "test-fixture-not-live-ai",
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          callId: randomUUID(),
          promptHash: "test",
        },
      };
    };
  const replyPlan = {
    customer_details: {
      name: "Verification customer",
      email: "fixture@example.invalid",
      phone: null,
    },
    department: "customer_service",
    action: "reply",
    summary: "Fixture inquiry",
    next_action: "Review reply",
    reply: "TEST FIXTURE — we can help.",
    selected_slot: null,
    preference: "",
  };
  try {
    unwrap(
      await admin.from("partners").insert({
        id: partnerId,
        name: "Temporary conversation verification",
        slug: `verify-${partnerId}`,
        is_test_account: true,
        status: "active",
      }),
    );
    unwrap(
      await admin.from("client_businesses").insert(
        [clientId, otherId].map((id) => ({
          id,
          partner_id: partnerId,
          name: "Temporary conversation verification",
          slug: `verify-${id}`,
          status: "active",
          is_test_account: true,
          crm_operating_mode: "primary_crm",
          timezone: "America/Chicago",
        })),
      ),
    );
    unwrap(
      await admin.from("memberships").insert({
        user_id: actor,
        partner_id: partnerId,
        client_id: clientId,
        role: "client_owner",
        status: "active",
      }),
    );
    unwrap(
      await admin.from("agent_team_settings").insert({
        partner_id: partnerId,
        client_id: clientId,
        status: "active",
        conversations_enabled: true,
        scheduling_enabled: true,
      }),
    );
    const provider = unwrap(
      await admin
        .from("integration_providers")
        .select("id")
        .eq("provider_key", "northstar_web_chat")
        .single(),
    );
    const connection = unwrap(
      await admin
        .from("integration_connections")
        .insert({
          partner_id: partnerId,
          client_id: clientId,
          provider_id: provider.id,
          display_name: "Verification chat",
          status: "connected",
          runtime_mode: "live",
          config: {},
        })
        .select("id")
        .single(),
    );
    const inbound = {
      ...scope,
      connectionId: connection.id,
      channel: "website_chat" as const,
      thread: randomUUID(),
      key: randomUUID(),
      body: "TEST FIXTURE: what services do you offer?",
    };
    const receipts = await Promise.all([
      ingestMessage(admin, inbound),
      ingestMessage(admin, inbound),
    ]);
    assert.equal(receipts[0].id, receipts[1].id);
    assert.equal(receipts.filter((r) => r.duplicate).length, 1);
    const cId = receipts[0].id;
    const c = await row(cId);
    assert.equal(c.identity_status, "unverified");
    assert.equal(
      unwrap(
        await admin
          .from("crm_communications")
          .select("id")
          .eq("client_id", clientId),
      ).length,
      1,
    );
    assert.ok(
      (await anon.from("business_conversation_messages").select("*")).error,
    );
    assert.equal(
      unwrap(
        await owner
          .from("business_conversations")
          .select("id")
          .eq("client_id", otherId),
      ).length,
      0,
    );
    assert.ok(
      (await owner.rpc("queue_conversation_work", { p_conversation: cId }))
        .error,
    );
    assert.ok(
      (
        await admin.rpc("ingest_business_message", {
          p_partner: partnerId,
          p_client: otherId,
          p_connection: connection.id,
          p_channel: "website_chat",
          p_thread: "wrong-scope",
          p_key: randomUUID(),
          p_body: "no",
        })
      ).error,
    );
    const wId = receipts.find((r) => r.workId)!.workId!;
    await respondToConversation(admin, await claim(wId), {
      isConfigured: () => false,
      generate: fixtureModel(replyPlan),
    });
    assert.equal((await workrow(wId)).status, "blocked");
    assert.equal((await row(cId)).state, "needs_attention");
    await control(cId, "retry");
    let work = unwrap(
      await admin
        .from("agent_work_items")
        .select("*")
        .eq("conversation_id", cId)
        .eq("status", "queued")
        .single(),
    ) as WorkItem;
    await respondToConversation(admin, await claim(work.id), {
      isConfigured: () => true,
      generate: fixtureModel(replyPlan, (user) =>
        assert.deepEqual(JSON.parse(user).customerContext, {}),
      ),
    });
    const captured = unwrap(
      await admin
        .from("crm_contacts")
        .select("email")
        .eq("id", c.contact_id)
        .single(),
    );
    assert.equal(captured.email, "fixture@example.invalid");
    assert.equal((await row(cId)).identity_status, "unverified");
    work = await workrow(work.id);
    assert.equal(work.status, "waiting_approval");
    const firstJob = await approve(work.approval_id!);
    assert.equal(firstJob.kind, "conversation.send");
    assert.equal((await executeActionJob(admin, firstJob)).status, "succeeded");
    const sent = unwrap(
      await admin
        .from("business_conversation_messages")
        .select("*")
        .eq("approval_id", work.approval_id!)
        .single(),
    );
    assert.equal(sent.status, "sent");
    const stale = await propose(cId);
    const staleJob = await approve(stale);
    await ingestMessage(admin, {
      ...inbound,
      key: randomUUID(),
      body: "TEST FIXTURE: I changed my mind.",
    });
    assert.match(
      (await conversationDeliveryBlock(admin, staleJob))!,
      /changed/,
    );
    assert.equal(await dispatchActionJob(admin, staleJob), null);
    const pending = await propose(cId);
    await control(cId, "takeover");
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("status")
          .eq("id", pending)
          .single(),
      ).status,
      "expired",
    );
    // An owner can still compose while the agents are paused; an AI assignment cannot.
    const manual = await propose(cId);
    assert.equal(
      (await executeActionJob(admin, await approve(manual))).status,
      "succeeded",
    );
    await control(cId, "resume");
    // Linking requires scoped records and a verification explanation.
    const customer = unwrap(
      await admin
        .from("crm_contacts")
        .insert({
          partner_id: partnerId,
          client_id: clientId,
          first_name: "Verified fixture",
          email: "fixture@example.invalid",
        })
        .select("id")
        .single(),
    );
    await control(cId, "link", {
      p_contact: customer.id,
      p_reason: "Verified in person during isolated test",
    });
    assert.equal((await row(cId)).identity_status, "owner_verified");
    // Second channel/same verified record: new activity invalidates the first channel draft.
    const second = await ingestMessage(admin, {
      ...inbound,
      thread: randomUUID(),
      key: randomUUID(),
      body: "TEST FIXTURE: second channel history",
    });
    await control(second.id, "link", {
      p_contact: customer.id,
      p_reason: "Verified in person during isolated test",
    });
    const cross = await propose(cId);
    await ingestMessage(admin, {
      ...inbound,
      thread: (await row(second.id)).external_thread_id,
      key: randomUUID(),
      body: "TEST FIXTURE: fresh activity on second thread",
    });
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("status")
          .eq("id", cross)
          .single(),
      ).status,
      "expired",
    );
    // Real local calendar availability, with a fixture model only for the decision.
    unwrap(
      await admin.from("crm_availability_windows").insert(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          partner_id: partnerId,
          client_id: clientId,
          weekday,
          start_time: "09:00",
          end_time: "17:00",
          appointment_minutes: 60,
          active: true,
        })),
      ),
    );
    await control(cId, "resume");
    work = unwrap(
      await admin
        .from("agent_work_items")
        .select("*")
        .eq("conversation_id", cId)
        .eq("status", "queued")
        .single(),
    ) as WorkItem;
    await respondToConversation(admin, await claim(work.id), {
      isConfigured: () => true,
      generate: fixtureModel(
        { ...replyPlan, department: "customer_service", action: "offer_slots" },
        (user) =>
          assert.ok(
            JSON.parse(user).customerContext.channel_history.some(
              (m: { body: string }) => m.body.includes("second thread"),
            ),
          ),
      ),
    });
    work = await workrow(work.id);
    assert.ok(work.approval_id);
    await executeActionJob(admin, await approve(work.approval_id!));
    const bookPlan = {
      ...replyPlan,
      department: "sales_assistant",
      action: "book_selected_slot",
      selected_slot: 1,
    };
    const vague = await ingestMessage(admin, {
      ...inbound,
      key: randomUUID(),
      body: "yes",
    });
    await respondToConversation(admin, await claim(vague.workId!), {
      isConfigured: () => true,
      generate: fixtureModel(bookPlan),
    });
    const clarification = await workrow(vague.workId!);
    assert.equal(
      clarification.result.booking_work_id,
      undefined,
      "A model choosing a slot from 'yes' must not create a booking",
    );
    assert.ok(clarification.approval_id);
    await executeActionJob(admin, await approve(clarification.approval_id!));

    // Handoffs are lease-checked, private to the tenant, and cancelled together
    // with the conversation when a customer changes their mind.
    const abandoned = await ingestMessage(admin, {
      ...inbound,
      key: randomUUID(),
      body: "Book option 1",
    });
    const abandonedClaim = await claim(abandoned.workId!);
    await respondToConversation(admin, abandonedClaim, {
      isConfigured: () => true,
      generate: fixtureModel(bookPlan),
    });
    const abandonedParent = await workrow(abandoned.workId!);
    const abandonedChild = await workrow(
      String(abandonedParent.result.booking_work_id),
    );
    for (const db of [owner, anon])
      assert.ok(
        (
          await db.rpc("delegate_conversation_booking", {
            p_work: abandonedClaim.id,
            p_claim: abandonedClaim.claim_token,
            p_offer: abandonedChild.input.offer_message_id,
            p_slot_index: 1,
          })
        ).error,
        "Browser roles cannot invoke a scheduling handoff",
      );
    assert.ok(
      (
        await admin.rpc("delegate_conversation_booking", {
          p_work: abandonedClaim.id,
          p_claim: abandonedClaim.claim_token,
          p_offer: abandonedChild.input.offer_message_id,
          p_slot_index: 1,
        })
      ).error,
      "The same consumed claim cannot create a second booking assignment",
    );
    assert.equal(
      unwrap(
        await admin
          .from("agent_work_items")
          .select("id")
          .eq("parent_id", abandonedParent.id),
      ).length,
      1,
    );

    // A blocked specialist stays visible to the original conversation owner.
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ scheduling_enabled: false })
        .eq("client_id", clientId),
    );
    await processBookingRequest(admin, await claim(abandonedChild.id));
    assert.equal((await workrow(abandonedChild.id)).status, "blocked");
    await respondToConversation(admin, await claim(abandonedParent.id));
    assert.equal(
      (await workrow(abandonedParent.id)).result.booking_status,
      "blocked",
    );
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ scheduling_enabled: true })
        .eq("client_id", clientId),
    );

    // A competing calendar appointment after the offer must prevent execution
    // and must never produce a customer confirmation.
    const conflictChoice = await ingestMessage(admin, {
      ...inbound,
      key: randomUUID(),
      body: "Please book option 1",
    });
    assert.equal((await workrow(abandonedParent.id)).status, "cancelled");
    assert.equal((await workrow(abandonedChild.id)).status, "cancelled");
    await respondToConversation(admin, await claim(conflictChoice.workId!), {
      isConfigured: () => true,
      generate: fixtureModel(bookPlan),
    });
    const conflictParent = await workrow(conflictChoice.workId!);
    const conflictChildId = String(conflictParent.result.booking_work_id);
    await processBookingRequest(admin, await claim(conflictChildId));
    const conflictChild = await workrow(conflictChildId);
    assert.ok(
      (
        await admin.rpc("confirm_conversation_booking", {
          p_approval: conflictChild.approval_id,
        })
      ).error,
      "An unexecuted booking cannot produce a confirmation",
    );
    const conflictSlot = conflictChild.input.slot as {
      start_iso: string;
      end_iso: string;
    };
    const conflictRecord = unwrap(
      await admin
        .from("crm_appointments")
        .insert({
          partner_id: partnerId,
          client_id: clientId,
          title: "Temporary conflict fixture",
          status: "booked",
          start_at: conflictSlot.start_iso,
          end_at: conflictSlot.end_iso,
        })
        .select("id")
        .single(),
    );
    const conflictJob = await approve(conflictChild.approval_id!);
    const conflictResult = await executeActionJob(admin, conflictJob);
    assert.equal(conflictResult.status, "failed");
    await processBookingRequest(admin, await claim(conflictChildId));
    assert.equal((await workrow(conflictChildId)).status, "waiting_external");
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("id")
          .eq("client_id", clientId)
          .contains("proposed_payload", {
            booking_approval_id: conflictChild.approval_id,
          }),
      ).length,
      0,
    );
    assert.ok(
      (
        await admin.rpc("confirm_conversation_booking", {
          p_approval: conflictChild.approval_id,
        })
      ).error,
      "Even an approved booking needs a successful receipt before confirmation",
    );
    unwrap(
      await admin.from("crm_appointments").delete().eq("id", conflictRecord.id),
    );
    const choice = await ingestMessage(admin, {
      ...inbound,
      key: randomUUID(),
      body: "TEST FIXTURE: please book option 1",
    });
    await respondToConversation(admin, await claim(choice.workId!), {
      isConfigured: () => true,
      generate: fixtureModel({
        ...replyPlan,
        department: "sales_assistant",
        action: "book_selected_slot",
        selected_slot: 1,
      }),
    });
    const parent = await workrow(choice.workId!);
    assert.equal(parent.status, "waiting_children");
    assert.equal(
      parent.agent_key,
      "sales_assistant",
      "The inquiry role keeps the conversation",
    );
    assert.equal(
      parent.approval_id,
      null,
      "Only scheduling proposes a booking",
    );
    const childId = String(parent.result.booking_work_id);
    assert.equal((await workrow(childId)).agent_key, "scheduling");
    assert.equal((await workrow(childId)).parent_id, parent.id);
    assert.equal((await workrow(childId)).conversation_id, cId);
    assert.equal((await row(cId)).agent_key, "sales_assistant");
    const childClaim = await claim(childId);
    await processBookingRequest(admin, childClaim);
    const bookingWork = await workrow(childId);
    const bookingJob = await approve(bookingWork.approval_id!);
    assert.equal(bookingJob.kind, "calendar.book");
    const booked = await executeActionJob(admin, bookingJob);
    assert.equal(booked.status, "succeeded");
    const confirmations = unwrap(
      await admin
        .from("approval_items")
        .select("*")
        .eq("client_id", clientId)
        .contains("proposed_payload", {
          booking_approval_id: bookingWork.approval_id,
        }),
    );
    assert.equal(confirmations.length, 1);
    unwrap(
      await admin.rpc("confirm_conversation_booking", {
        p_approval: bookingWork.approval_id,
      }),
    );
    assert.equal(
      unwrap(
        await admin
          .from("approval_items")
          .select("id")
          .contains("proposed_payload", {
            booking_approval_id: bookingWork.approval_id,
          }),
      ).length,
      1,
    );
    await processBookingRequest(admin, await claim(childId));
    assert.equal(
      (await workrow(childId)).status,
      "waiting_approval",
      "Booking is not the end until confirmation is handled",
    );
    await respondToConversation(admin, await claim(parent.id), {
      isConfigured: () => false,
      generate: fixtureModel(replyPlan, () => {
        throw new Error("Tracking a handoff must not call AI");
      }),
    });
    assert.equal((await workrow(parent.id)).status, "waiting_children");
    await executeActionJob(admin, await approve(confirmations[0].id));
    await processBookingRequest(admin, await claim(childId));
    await respondToConversation(admin, await claim(parent.id));
    assert.equal((await workrow(childId)).status, "completed");
    assert.equal((await workrow(parent.id)).status, "completed");
    assert.equal((await workrow(parent.id)).result.booking_status, "completed");
    assert.equal(
      unwrap(
        await admin
          .from("crm_appointments")
          .select("id,contact_id")
          .eq("approval_id", bookingWork.approval_id!),
      ).length,
      1,
    );
    await ingestMessage(admin, { ...inbound, key: randomUUID(), body: "STOP" });
    assert.equal((await row(cId)).opted_out, true);
    assert.ok(
      (
        await admin.rpc("propose_conversation_action", {
          p_partner: partnerId,
          p_client: clientId,
          p_id: cId,
          p_revision: (await row(cId)).revision,
          p_kind: "reply",
          p_body: "blocked",
          p_actor: actor,
        })
      ).error,
    );
    unwrap(
      await admin
        .from("agent_team_settings")
        .update({ administration_enabled: true, marketing_enabled: true })
        .eq("client_id", clientId),
    );
    const adminWork = await assignWork(admin, scope, {
      kind: "administration_review",
      title: "Operations verification",
      key: randomUUID(),
    });
    await departmentOutput(admin, await claim(adminWork));
    assert.equal((await workrow(adminWork)).status, "completed");
    assert.ok((await workrow(adminWork)).result_record_id);
    const marketingWork = await assignWork(admin, scope, {
      kind: "marketing_campaign",
      title: "Marketing verification",
      key: randomUUID(),
    });
    const marketingClaim = await claim(marketingWork);
    const campaign = unwrap(
      await admin.rpc("save_agent_business_output", {
        p_work: marketingWork,
        p_claim: marketingClaim.claim_token,
        p_title: "TEST FIXTURE campaign",
        p_body:
          "TEST FIXTURE approved-facts campaign. Not generated by a live model.",
        p_data: {
          channel: "Email",
          audience: "Fixture",
          objective: "Verify the review lifecycle",
          budget: 0,
        },
      }),
    );
    assert.equal((await workrow(marketingWork)).status, "waiting_approval");
    const cr = unwrap(
      await admin
        .from("business_records")
        .select("revision")
        .eq("id", campaign)
        .single(),
    );
    unwrap(
      await admin.rpc("transition_business_record", {
        p_partner: partnerId,
        p_client: clientId,
        p_actor: actor,
        p_id: campaign,
        p_revision: cr.revision,
        p_action: "approve",
        p_reference: "",
      }),
    );
    await departmentOutput(admin, await claim(marketingWork));
    assert.equal((await workrow(marketingWork)).status, "completed");
    console.log(
      "PASS: concurrent dedupe, scoped CRM persistence, RLS, missing model, owner approval, website delivery, takeover, verified shared history, shared availability, ambiguous-choice clarification, durable scheduling handoff, replay denial, paused specialist, parent/child cancellation, calendar conflict, no premature confirmation, approved booking, same-thread confirmation, parent completion, opt-out. Model decisions were explicit fixtures; no external messages sent.",
    );
  } finally {
    for (const table of [
      "agent_work_items",
      "business_conversation_messages",
      "business_conversation_events",
      "business_conversations",
      "business_workspace_events",
      "business_records",
      "action_jobs",
      "crm_appointments",
      "approval_items",
    ])
      unwrap(await admin.from(table).delete().eq("client_id", clientId));
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
  console.error(error);
  process.exitCode = 1;
});
