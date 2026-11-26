import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadDeliveryAccount, selectDeliveryAccount, type DeliveryAccount, type DeliveryActivation } from "../lib/delivery/channel-selection.ts";
import { googlePermissionScopes } from "../lib/connections/google-permissions.ts";

const now = Date.parse("2026-11-18T12:00:00Z"), input = { partnerId: "partner", clientId: "business", channel: "email" as const, now };
const account = (id: string, provider: string, patch: Partial<DeliveryAccount> = {}): DeliveryAccount => ({
  id, partner_id: input.partnerId, client_id: input.clientId, status: "connected", runtime_mode: "live", credential_status: "configured", error_count: 0, config: {}, provider: { provider_key: provider }, ...patch,
});
const plan: DeliveryActivation = { status: "active", email: true, workspace_connection_id: "chosen-google", workspace_provider: "google_workspace" };
const google = () => account("chosen-google", "google_workspace", { config: { workspace_view_only: true, activation_selected: true, activation_mail_verified: true,
  activation_checked_at: new Date(now).toISOString(), google_action_permissions: { email_send: true }, google_verified_scopes: googlePermissionScopes(["email.send"]) } });

test("an explicit delivery account never falls back, while a bound legacy dry run remains honest", () => {
  const resend = account("resend", "resend"), dry = account("bound", "resend", { runtime_mode: "dry_run" });
  assert.equal(selectDeliveryAccount({ ...input, connectionId: "bound" }, [resend, dry], null).connection?.id, "bound");
  assert.equal(selectDeliveryAccount({ ...input, connectionId: "missing" }, [resend], null).connection, null);
  assert.equal(selectDeliveryAccount({ ...input, connectionId: "" }, [resend], null).connection, null);
  const read = account("bound", "google_workspace", { config: { workspace_view_only: true } });
  assert.equal(selectDeliveryAccount({ ...input, connectionId: "bound" }, [resend, read], plan).connection, null);
});
test("unbound email retains only the owner's exact selected eligible Google or Microsoft account", () => {
  const rows = [account("other-google", "google_workspace"), account("resend", "resend"), google()];
  assert.equal(selectDeliveryAccount(input, rows, plan).connection?.id, "chosen-google");
  assert.equal(selectDeliveryAccount(input, [account("only-google", "google_workspace")], null).connection, null);
  const microsoft = account("chosen-ms", "microsoft_365");
  assert.equal(selectDeliveryAccount(input, [microsoft, account("resend", "resend")], { ...plan, workspace_connection_id: microsoft.id, workspace_provider: "microsoft_365" }).connection?.id, microsoft.id);
});
test("paused, stale or revoked selected Google evidence blocks delivery rather than switching accounts", () => {
  for (const mutate of [
    (row: DeliveryAccount) => { row.runtime_mode = "paused"; },
    (row: DeliveryAccount) => { row.status = "needs_attention"; },
    (row: DeliveryAccount) => { row.credential_status = "missing"; },
    (row: DeliveryAccount) => { row.config!.activation_selected = false; },
    (row: DeliveryAccount) => { row.config!.activation_mail_verified = false; },
    (row: DeliveryAccount) => { row.config!.google_action_permissions = { email_send: false }; },
    (row: DeliveryAccount) => { row.config!.activation_checked_at = new Date(now - 24 * 3600000).toISOString(); },
    (row: DeliveryAccount) => { row.config!.activation_checked_at = new Date(now + 120000).toISOString(); },
  ]) {
    const row = google(); mutate(row);
    assert.equal(selectDeliveryAccount(input, [row, account("fallback", "resend")], plan).connection, null);
  }
  assert.equal(selectDeliveryAccount(input, [account("fallback", "resend")], plan).connection, null);
});
test("unbound legacy email and SMS require exactly one live configured eligible account", () => {
  const resend = account("one", "resend"), twilio = account("text", "twilio");
  assert.equal(selectDeliveryAccount(input, [resend, google()], null).connection?.id, resend.id);
  assert.equal(selectDeliveryAccount(input, [resend, account("two", "resend")], null).connection, null);
  assert.equal(selectDeliveryAccount(input, [account("dry", "resend", { runtime_mode: "dry_run" })], null).connection, null);
  assert.equal(selectDeliveryAccount({ ...input, channel: "sms" }, [resend, twilio], null).connection?.id, twilio.id);
  assert.equal(selectDeliveryAccount({ ...input, channel: "sms" }, [twilio, account("two", "twilio")], null).connection, null);
  assert.equal(selectDeliveryAccount({ ...input, channel: "sms", connectionId: resend.id }, [resend, twilio], null).connection, null);
});
test("foreign scope and bounded partial account coverage cannot produce a delivery choice", () => {
  assert.equal(selectDeliveryAccount(input, [account("foreign", "resend", { client_id: "other" })], null).connection, null);
  assert.equal(selectDeliveryAccount(input, [account("one", "resend")], null, false).connection, null);
  assert.equal(selectDeliveryAccount(input, Array.from({ length: 101 }, (_, index) => account(String(index), "resend")), null).connection, null);
});
test("repository scopes and provider-filters accounts before the deterministic bound and fails closed on read errors", async () => {
  const operations: { table: string; method: string; args: unknown[] }[] = [];
  let failed = false;
  const admin = { from(table: string) {
    const query = { select(...args: unknown[]) { operations.push({ table, method: "select", args }); return query; },
      eq(...args: unknown[]) { operations.push({ table, method: "eq", args }); return query; },
      in(...args: unknown[]) { operations.push({ table, method: "in", args }); return query; },
      order(...args: unknown[]) { operations.push({ table, method: "order", args }); return query; },
      limit(...args: unknown[]) { operations.push({ table, method: "limit", args }); return query; },
      maybeSingle() { return Promise.resolve({ data: null, error: failed ? { message: "Unavailable" } : null }); },
      then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [account("one", "resend")], error: failed ? { message: "Unavailable" } : null }).then(resolve); },
    }; return query;
  } } as unknown as SupabaseClient;
  assert.equal((await loadDeliveryAccount(admin, input)).connection?.id, "one");
  const calls = operations.filter((operation) => operation.table === "integration_connections"), bound = calls.findIndex((operation) => operation.method === "limit");
  for (const field of ["partner_id", "client_id", "provider.provider_key", "status"]) assert.ok(calls.findIndex((operation) => operation.args[0] === field) < bound);
  assert.deepEqual(calls[bound].args, [101]); assert.equal(calls[bound - 1].method, "order");
  failed = true; assert.equal((await loadDeliveryAccount(admin, input)).connection, null);
});
