import assert from "node:assert/strict";
import test from "node:test";
import { submitOwnerApproval } from "../lib/approvals/owner-client.ts";
import { OwnerApprovalCommandSchema, OwnerApprovalResultSchema } from "../lib/approvals/owner-command.ts";

const id = "11111111-1111-4111-8111-111111111111";
function decision(resolution = "approve") {
  const form = new FormData(); form.set("resolution", resolution); return form;
}

test("owner decisions send one scoped JSON request and retain actual409 as a form error", async () => {
  const form = decision("edit_and_approve"); form.set("edited_content", "Reviewed edit"); form.set("note", "Owner note");
  let calls = 0;
  const conflict = { status: "error", httpStatus: 409, message: "The source changed. Refresh and review." };
  const result = await submitOwnerApproval(id, form, async (url, init) => {
    calls++; assert.equal(url, `/api/business/approvals/${id}`); assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "same-origin"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    assert.deepEqual(JSON.parse(String(init?.body)), { resolution: "edit_and_approve", editedContent: "Reviewed edit", note: "Owner note" });
    return Response.json(conflict, { status: 409 });
  });
  assert.deepEqual(result, conflict); assert.equal(calls, 1);
});

test("approval receipts bound response bytes and field error sizes without leaking response bodies", async () => {
  let calls = 0;
  const result = await submitOwnerApproval(id, decision(), async () => {
    calls++;
    return new Response(JSON.stringify({ status: "success", httpStatus: 200, message: "private receipt".repeat(3000) }));
  });
  assert.equal(result.httpStatus, 503); assert.equal(calls, 1); assert.doesNotMatch(result.message, /private receipt/);
  const base = { status: "error", httpStatus: 422, message: "Check the note." };
  assert.equal(OwnerApprovalResultSchema.safeParse({ ...base, fieldErrors: { note: "Use a shorter note." } }).success, true);
  for (const fieldErrors of [{ note: "x".repeat(1001) }, { ["x".repeat(81)]: "invalid" }, Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`field${index}`, "invalid"]))])
    assert.equal(OwnerApprovalResultSchema.safeParse({ ...base, fieldErrors }).success, false);
});

test("only complete matching success receipts report an owner decision saved", async () => {
  const success = { status: "success", httpStatus: 200, message: "Approval recorded." };
  assert.deepEqual(await submitOwnerApproval(id, decision(), async () => Response.json(success)), success);
  for (const body of [{ status: "success" }, { ...success, message: "" }, { ...success, httpStatus: 409 }, { ...success, debug: "private detail" }, { status: "error", httpStatus: 200, message: "Invalid state" }]) {
    let calls = 0;
    const result = await submitOwnerApproval(id, decision(), async () => { calls++; return Response.json(body); });
    assert.equal(result.status, "error"); assert.equal(result.httpStatus, 503); assert.match(result.message, /check Action history/);
    assert.doesNotMatch(result.message, /private detail/); assert.equal(calls, 1);
  }
  assert.equal((await submitOwnerApproval(id, decision(), async () => Response.json(success, { status: 409 }))).httpStatus, 503);
});

test("lost responses and unreadable receipts stay uncertain without another approval request", async () => {
  for (const request of [async () => { throw new Error("private network detail"); }, async () => new Response("private non-JSON reply", { status: 200 })]) {
    let calls = 0;
    const result = await submitOwnerApproval(id, decision(), async () => { calls++; return request(); });
    assert.equal(result.httpStatus, 503); assert.equal(result.status, "error");
    assert.match(result.message, /Refresh approvals and check Action history before deciding again/);
    assert.doesNotMatch(result.message, /private/); assert.equal(calls, 1);
  }
});

test("unknown scope, duplicate decisions, files and oversized content are rejected before transport", async () => {
  const unknown = decision(); unknown.set("clientId", id);
  const duplicate = decision(); duplicate.append("resolution", "reject");
  const file = decision(); file.set("note", new Blob(["unexpected upload"]), "note.txt");
  const oversized = decision(); oversized.set("edited_content", "💬".repeat(9000));
  let calls = 0;
  for (const form of [unknown, duplicate, file, oversized, decision("unsupported")]) {
    const result = await submitOwnerApproval(id, form, async () => { calls++; throw new Error(); });
    assert.equal(result.httpStatus, 400); assert.equal(result.status, "error");
  }
  assert.equal((await submitOwnerApproval("invalid-id", decision(), async () => { calls++; throw new Error(); })).httpStatus, 400);
  assert.equal(calls, 0);
  for (const field of ["clientId", "actorId", "partnerId", "unexpected"]) assert.equal(OwnerApprovalCommandSchema.safeParse({ resolution: "approve", [field]: id }).success, false);
});
