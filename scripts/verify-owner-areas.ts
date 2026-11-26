import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { mutateTodo } from "../lib/business/todo-mutations";
import type { ClientPortal } from "../lib/clients/portal";
import { buildAccessContext } from "../lib/permissions/roles";

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
  const check = <T>(value: {
    data: T;
    error: { message: string } | null;
  }): T => {
    if (value.error) throw new Error(value.error.message);
    return value.data;
  };
  const access = buildAccessContext({
    userId: randomUUID(),
    role: "client_owner",
    clientId,
    partnerId,
    clientPortalEnabled: true,
  });
  const portal = {
    kind: "ok",
    client: { id: clientId, partner_id: partnerId },
    access,
  } as Extract<ClientPortal, { kind: "ok" }>;
  check(
    await admin
      .from("partners")
      .insert({
        id: partnerId,
        name: "Disposable owner area verification",
        slug: `verify-${partnerId}`,
        is_test_account: true,
        status: "active",
      }),
  );
  try {
    check(
      await admin
        .from("client_businesses")
        .insert(
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
    const tasks = check(
      await admin
        .from("crm_tasks")
        .insert(
          [clientId, otherId].map((client_id) => ({
            partner_id: partnerId,
            client_id,
            title: "Disposable verification task",
          })),
        )
        .select("id,client_id,updated_at"),
    );
    assert.ok(tasks);
    const own = tasks.find((task) => task.client_id === clientId)!;
    const other = tasks.find((task) => task.client_id === otherId)!;
    await assert.rejects(
      () =>
        mutateTodo(admin, portal, {
          action: "task_status",
          id: other.id,
          status: "done",
          updatedAt: other.updated_at,
        }),
      /changed or is unavailable/,
    );
    await assert.rejects(
      () =>
        mutateTodo(
          admin,
          {
            ...portal,
            access: {
              ...access,
              isImpersonating: true,
              impersonationMode: "read_only",
            },
          },
          {
            action: "task_status",
            id: own.id,
            status: "done",
            updatedAt: own.updated_at,
          },
        ),
      /permission/,
    );
    await mutateTodo(admin, portal, {
      action: "task_status",
      id: own.id,
      status: "done",
      updatedAt: own.updated_at,
    });
    const saved = check(
      await admin
        .from("crm_tasks")
        .select("status,completed_at,updated_at")
        .eq("client_id", clientId)
        .eq("id", own.id)
        .single(),
    );
    assert.ok(saved);
    assert.equal(saved.status, "done");
    assert.ok(saved.completed_at);
    await assert.rejects(
      () =>
        mutateTodo(admin, portal, {
          action: "task_status",
          id: own.id,
          status: "open",
          updatedAt: own.updated_at,
        }),
      /changed or is unavailable/,
    );
    await mutateTodo(admin, portal, {
      action: "task_status",
      id: own.id,
      status: "open",
      updatedAt: saved.updated_at,
    });
    const reopened = check(
      await admin
        .from("crm_tasks")
        .select("status,completed_at")
        .eq("client_id", clientId)
        .eq("id", own.id)
        .single(),
    );
    assert.ok(reopened);
    assert.equal(reopened.status, "open");
    assert.equal(reopened.completed_at, null);
    const unchanged = check(
      await admin
        .from("crm_tasks")
        .select("status")
        .eq("id", other.id)
        .single(),
    );
    assert.equal(unchanged?.status, "open");
    console.log(
      "Verified: task completion/reopen, persisted completion time, stale-write rejection, cross-business isolation, read-only rejection.",
    );
  } finally {
    check(await admin.from("crm_tasks").delete().eq("partner_id", partnerId));
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
