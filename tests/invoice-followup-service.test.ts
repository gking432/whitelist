import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeInvoiceFollowupCommand, invoiceReviewRevision } from "../lib/money/service.ts";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { partnerId: id(1), clientId: id(2), actorId: id(3) };
const request = { action: "handoff_invoice_followup" as const, key: id(4), targetId: id(5), connectionId: id(6), expectedRevision: "historical-source" };
function savedAdmin(saved: Record<string, unknown>) {
  const filters: unknown[] = [];
  const q = { select() { return this; }, eq(...v: unknown[]) { filters.push(v); return this; }, async maybeSingle() { return { data: saved, error: null }; } };
  return { filters, admin: { from(table: string) { assert.equal(table, "business_owner_commands", "replay must precede changed source/recipient/provider reads"); return q; }, rpc() { assert.fail("a saved request must not create another proposal or task"); } } as unknown as SupabaseClient };
}
test("invoice decision replay survives changed live facts and JSONB key ordering", async () => {
  const reordered = Object.fromEntries(Object.entries(request).reverse());
  const { admin, filters } = savedAdmin({ actor_id: actor.actorId, command: { owner_request: reordered }, result: { id: id(7), sourceRecordId: request.targetId, taskId: id(8), approvalId: null, replayed: false, message: "Saved earlier" } });
  assert.equal((await executeInvoiceFollowupCommand(admin, actor, request)).replayed, true);
  assert.ok(filters.some((f) => JSON.stringify(f) === JSON.stringify(["partner_id", actor.partnerId])));
  await assert.rejects(executeInvoiceFollowupCommand(admin, { ...actor, actorId: id(9) }, request), /different invoice decision/);
  await assert.rejects(executeInvoiceFollowupCommand(admin, actor, { ...request, note: "changed" }), /different invoice decision/);
});
test("uncorrelated or partial invoice decision receipts never claim a save", async () => {
  const { admin } = savedAdmin({ actor_id: actor.actorId, command: { owner_request: request }, result: { id: id(7), sourceRecordId: id(9), taskId: id(8), approvalId: null, replayed: false, message: "Wrong source" } });
  await assert.rejects(executeInvoiceFollowupCommand(admin, actor, request), /exact saved invoice decision/);
});
test("unsupported fields and false permission assertions fail before repository access", async () => {
  const admin = { from() { assert.fail("invalid public commands cannot touch persistence"); } } as unknown as SupabaseClient;
  for (const extra of [{ to: "claimed@example.test" }, { identityConfirmed: false }, { outreachPermissionConfirmed: false }]) await assert.rejects(executeInvoiceFollowupCommand(admin, actor, { ...request, ...extra }), /supported decision/);
  assert.equal(invoiceReviewRevision({ a: 1, b: { x: 2, y: 3 } }), invoiceReviewRevision({ b: { y: 3, x: 2 }, a: 1 }));
});
