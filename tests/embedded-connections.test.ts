import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, verify } from "node:crypto";
import {
  authenticationMatches,
  connectUrl,
  partnerJwt,
  zapierJwks,
  ZapierClient,
  zapierForIdentity,
} from "../lib/integrations/embedded/zapier.ts";
import {
  fieldPaths,
  mapFields,
  readField,
  validateFields,
  validateInbound,
} from "../lib/integrations/embedded/mapping.ts";
import {
  commitInboxLease,
  createApprovedExternalRun,
} from "../lib/integrations/embedded/protocol.ts";
import { authorizedActionPayload } from "../lib/jobs/execution-state.ts";
import type { EmbeddedBinding } from "../lib/integrations/embedded/runtime.ts";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const env = {
  ZAPIER_WHITE_LABEL_CLIENT_ID: "synthetic",
  ZAPIER_WHITE_LABEL_CLIENT_SECRET: "synthetic-secret",
  ZAPIER_WHITE_LABEL_PRIVATE_KEY: keys.privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString(),
  ZAPIER_WHITE_LABEL_KEY_ID: "test-key",
  ZAPIER_WHITE_LABEL_ISSUER: "https://synthetic.invalid",
  ZAPIER_WHITE_LABEL_SCOPES: "connection:read action:run zap",
};
test("JWT identity is client scoped, signed, short lived; JWKS exposes no private material", () => {
  const jwt = partnerJwt(
    { partnerId: "agency", clientId: "client-a", userId: "person" },
    env,
    100,
  );
  const [header, payload, signature] = jwt.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.org_id, "agency:client-a");
  assert.equal(claims.sub, "person");
  assert.equal(claims.exp - claims.iat, 300);
  assert(
    verify(
      "RSA-SHA256",
      Buffer.from(`${header}.${payload}`),
      keys.publicKey,
      Buffer.from(signature, "base64url"),
    ),
  );
  assert.notEqual(
    jwt,
    partnerJwt(
      { partnerId: "agency", clientId: "client-b", userId: "person" },
      env,
      100,
    ),
  );
  assert(!JSON.stringify(zapierJwks(env)).includes('"d":'));
});
test("connect token exchange is resource-bound and keeps API token out of browser URL", async () => {
  const calls: URLSearchParams[] = [];
  const fetcher = (async (url, init) => {
    assert.equal(url, "https://zapier.com/oauth/token");
    calls.push(new URLSearchParams(String(init?.body)));
    return Response.json({
      access_token: calls.length === 1 ? "server-only" : "single-use",
    });
  }) as typeof fetch;
  const client = await zapierForIdentity(
    { partnerId: "p", clientId: "c", userId: "u" },
    env,
    fetcher,
  );
  const url = await connectUrl(client, "app-id", env, fetcher);
  assert.equal(
    calls[1].get("resource"),
    "https://connect.zapier.com/to/app-id",
  );
  assert.equal(new URL(url).searchParams.get("token"), "single-use");
  assert(!url.includes("server-only"));
});
test("connection verification rejects another app, another account, and expired authorization", () => {
  const auth = {
    id: "owned",
    app: { id: "app" },
    title: "Test",
    is_expired: false,
  };
  assert(authenticationMatches(auth, "app", "owned"));
  assert(!authenticationMatches(auth, "other", "owned"));
  assert(!authenticationMatches(auth, "app", "other"));
  assert(!authenticationMatches({ ...auth, is_expired: true }, "app", "owned"));
});
test("mapping preserves false/zero and nested arrays without evaluating code or inherited properties", () => {
  const result = mapFields(
    { customer: { email: "test@synthetic.invalid" }, items: [{ total: 0 }] },
    {
      email: { path: "customer.email" },
      amount: { path: "items.0.total" },
      opted_in: { value: false },
    },
  );
  assert.deepEqual(result, {
    email: "test@synthetic.invalid",
    amount: 0,
    opted_in: false,
  });
  assert.equal(readField({}, "constructor.name"), undefined);
  assert.equal(
    readField(Object.create({ inherited: "no" }), "inherited"),
    undefined,
  );
  assert.throws(() =>
    mapFields({}, JSON.parse('{"__proto__":{"value":true}}')),
  );
  assert(fieldPaths({ items: [{ id: 1 }] }).includes("items.0.id"));
});
test("required inputs, changed field definitions and minimum lead data are checked", () => {
  const fields = [
    {
      id: "amount",
      type: "input_field",
      title: "Amount",
      value_type: "NUMBER",
      is_required: true,
    },
  ];
  validateFields(fields, { amount: 0 });
  assert.throws(() => validateFields(fields, {}));
  assert.throws(() => validateFields(fields, { amount: "10" }));
  assert.throws(() => validateFields(fields, { amount: 10, old_field: true }));
  validateInbound(["name", "phone or email"], {
    name: "Test",
    email: "test@synthetic.invalid",
  });
  assert.throws(() => validateInbound(["phone or email"], {}));
});
const binding = {
  id: "binding",
  field_mapping: {
    name: { path: "person.name" },
    email: { path: "person.email" },
  },
} as unknown as EmbeddedBinding;
test("inbox acknowledges only messages committed durably, including redelivery after lost acknowledgment", async () => {
  const committed = new Map();
  let acknowledgeFails = true;
  const input = {
    binding,
    requiredFields: ["name", "phone or email"],
    lease: {
      lease_id: "lease",
      inbox_attributes: { status: "active" },
      results: [
        {
          id: "m1",
          payload: {
            person: { name: "Test", email: "test@synthetic.invalid" },
          },
        },
      ],
    },
    commit: async (id: string, value: Record<string, unknown>) => {
      committed.set(id, value);
    },
    acknowledge: async (_lease: string, ids: string[]) => {
      assert(committed.has(ids[0]));
      if (acknowledgeFails) throw new Error("lost ack");
    },
  };
  await assert.rejects(commitInboxLease(input));
  acknowledgeFails = false;
  assert.equal(await commitInboxLease(input), 1);
  assert.equal(committed.size, 1);
});
test("failed persistence, incomplete data, and possible duplicates are never acknowledged", async () => {
  let acked = false;
  const input = {
    binding,
    requiredFields: [],
    lease: {
      lease_id: "l",
      inbox_attributes: { status: "active" },
      results: [{ id: "m", payload: {} }],
    },
    commit: async () => {
      throw new Error("database down");
    },
    acknowledge: async () => {
      acked = true;
    },
  };
  await assert.rejects(commitInboxLease(input));
  assert.equal(acked, false);
  await assert.rejects(
    commitInboxLease({
      ...input,
      lease: {
        ...input.lease,
        results: [
          {
            id: "m",
            payload: {},
            message_attributes: { possible_duplicate_data: true },
          },
        ],
      },
    }),
  );
  assert.equal(acked, false);
});
test("external actions use immutable matching human approval", () => {
  const approval = {
    id: "approval",
    partner_id: "p",
    client_id: "c",
    type: "external_action",
    status: "approved",
    resolved_content: null,
    proposed_payload: { input: { note: "approved" } },
  };
  const job = {
    approval_id: "approval",
    partner_id: "p",
    client_id: "c",
    kind: "external.action",
  };
  assert.deepEqual(
    authorizedActionPayload(job, approval),
    approval.proposed_payload,
  );
  assert.equal(
    authorizedActionPayload({ ...job, client_id: "other" }, approval),
    null,
  );
  assert.equal(
    authorizedActionPayload(job, { ...approval, status: "pending" }),
    null,
  );
});
test("external submission discovers a fresh action id, persists its run id and waits for confirmation", async () => {
  const submitted: string[] = [];
  let lookups = 0,
    persisted = "";
  const api = new ZapierClient("synthetic", (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v2/authentications")
      return Response.json({
        data: [{ id: "auth", app: "app", is_expired: false }],
      });
    if (path === "/v2/actions")
      return Response.json({
        data: [
          { id: `fresh-${++lookups}`, key: "create", action_type: "WRITE" },
        ],
      });
    if (path.endsWith("/inputs"))
      return Response.json({
        data: [
          {
            id: "note",
            type: "input_field",
            title: "Note",
            value_type: "STRING",
            is_required: true,
          },
        ],
      });
    if (path === "/v2/action-runs/") {
      submitted.push(JSON.parse(String(init?.body)).data.action);
      return Response.json({ data: { id: `run-${lookups}` } });
    }
    throw new Error("Unexpected request");
  }) as typeof fetch);
  for (let index = 0; index < 2; index++) {
    const outcome = await createApprovedExternalRun(api, {
      appId: "app",
      authenticationId: "auth",
      actionKey: "create",
      values: { note: "Approved" },
      onRunId: async (id) => {
        persisted = id;
      },
    });
    assert.equal(outcome.status, "provider_pending");
    assert.equal(outcome.delivered, false);
    assert.equal(outcome.externalRef, persisted);
  }
  assert.deepEqual(submitted, ["fresh-1", "fresh-2"]);
});
test("ambiguous action submission is quarantined without retry", async () => {
  let posts = 0;
  const api = new ZapierClient("synthetic", (async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/v2/authentications")
      return Response.json({
        data: [{ id: "auth", app: "app", is_expired: false }],
      });
    if (path === "/v2/actions")
      return Response.json({
        data: [{ id: "fresh", key: "create", action_type: "WRITE" }],
      });
    if (path.endsWith("/inputs")) return Response.json({ data: [] });
    posts++;
    throw new Error("response lost");
  }) as typeof fetch);
  const outcome = await createApprovedExternalRun(api, {
    appId: "app",
    authenticationId: "auth",
    actionKey: "create",
    values: {},
    onRunId: async () => {},
  });
  assert.equal(outcome.status, "uncertain");
  assert.equal(posts, 1);
});
