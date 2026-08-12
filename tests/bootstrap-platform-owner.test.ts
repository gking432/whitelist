import assert from "node:assert/strict";
import test from "node:test";

import {
  bootstrapPlatformOwner,
  parseBootstrapArguments,
} from "../scripts/bootstrap-platform-owner.ts";

type Membership = {
  id: string;
  user_id: string;
  role: string;
  partner_id: string | null;
  client_id: string | null;
  status: string;
};

function fakeAdmin(input?: { existingUser?: boolean; memberships?: Membership[] }) {
  const user = {
    id: "user-1",
    email: "owner@example.com",
    user_metadata: {},
  };
  const memberships = [...(input?.memberships ?? [])];
  const invited: string[] = [];
  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    let mutation: { kind: "insert" | "update"; payload: Record<string, unknown> } | null = null;
    let selecting = false;
    const builder = {
      select() { selecting = true; return builder; },
      eq(key: string, value: unknown) { filters[key] = value; return builder; },
      is(key: string, value: unknown) { filters[key] = value; return builder; },
      update(payload: Record<string, unknown>) { mutation = { kind: "update", payload }; return builder; },
      insert(payload: Record<string, unknown>) { mutation = { kind: "insert", payload }; return builder; },
      async upsert() { return { error: null }; },
      async maybeSingle() {
        const found = memberships.find((membership) =>
          Object.entries(filters).every(([key, value]) => membership[key as keyof Membership] === value),
        );
        return { data: found ? { id: found.id } : null, error: null };
      },
      then(resolve: (value: { data?: Membership[]; error: null }) => unknown) {
        if (selecting && !mutation) {
          const data = memberships.filter((membership) =>
            Object.entries(filters).every(([key, value]) => membership[key as keyof Membership] === value),
          );
          return Promise.resolve(resolve({ data, error: null }));
        }
        if (mutation?.kind === "insert") {
          memberships.push({ id: "membership-new", ...(mutation.payload as Omit<Membership, "id">) });
        } else if (mutation?.kind === "update") {
          const found = memberships.find((membership) =>
            Object.entries(filters).every(([key, value]) => membership[key as keyof Membership] === value),
          );
          if (found) Object.assign(found, mutation.payload);
        }
        return Promise.resolve(resolve({ error: null }));
      },
    };
    if (table === "memberships") return builder;
    return { async upsert() { return { error: null }; } };
  };
  return {
    client: {
      auth: {
        admin: {
          async listUsers() {
            return {
              data: { users: input?.existingUser ? [user] : [] },
              error: null,
            };
          },
          async inviteUserByEmail(email: string) {
            invited.push(email);
            return { data: { user }, error: null };
          },
        },
      },
      from: query,
    },
    invited,
    memberships,
  };
}

test("owner bootstrap arguments require a dedicated email and public app URL", () => {
  assert.deepEqual(
    parseBootstrapArguments([
      "--email",
      "Owner@Example.com",
      "--app-url",
      "https://app.example.com/",
      "--dry-run",
    ]),
    {
      email: "owner@example.com",
      fullName: undefined,
      appUrl: "https://app.example.com",
      dryRun: true,
    },
  );
  assert.throws(() => parseBootstrapArguments(["--email", "bad"]));
});

test("owner bootstrap invites once and creates only a platform membership", async () => {
  const fake = fakeAdmin();
  const result = await bootstrapPlatformOwner(fake.client as never, {
    email: "owner@example.com",
    fullName: "Platform Owner",
    appUrl: "https://app.example.com",
    dryRun: false,
  });
  assert.equal(result.existingUser, false);
  assert.deepEqual(fake.invited, ["owner@example.com"]);
  assert.equal(fake.memberships.length, 1);
  assert.equal(fake.memberships[0]?.role, "platform_owner");
  assert.equal(fake.memberships[0]?.partner_id, null);
});

test("owner bootstrap dry run does not invite or mutate", async () => {
  const fake = fakeAdmin();
  const result = await bootstrapPlatformOwner(fake.client as never, {
    email: "owner@example.com",
    appUrl: "https://app.example.com",
    dryRun: true,
  });
  assert.equal(result.dryRun, true);
  assert.deepEqual(fake.invited, []);
  assert.deepEqual(fake.memberships, []);
});

test("owner bootstrap refuses an identity already attached to a tenant", async () => {
  const fake = fakeAdmin({
    existingUser: true,
    memberships: [
      {
        id: "partner-role",
        user_id: "user-1",
        role: "partner_owner",
        partner_id: "partner-1",
        client_id: null,
        status: "active",
      },
    ],
  });
  await assert.rejects(
    bootstrapPlatformOwner(fake.client as never, {
      email: "owner@example.com",
      appUrl: "https://app.example.com",
      dryRun: false,
    }),
    /dedicated platform-owner email/,
  );
});
