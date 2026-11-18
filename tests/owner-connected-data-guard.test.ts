import test from "node:test";
import assert from "node:assert/strict";
import { validateOwnerConnectedFixture, verifyOwnerConnectedData } from "../scripts/verify-owner-connected-data.ts";

const fixture = { version: 1, confirmation: "owner-browser-disposable", runId: "123456abcdef", partnerId: "10000000-0000-4000-8000-000000000001", clientId: "10000000-0000-4000-8000-000000000002", ownerId: "10000000-0000-4000-8000-000000000003", marker: "owner-browser-123456abcdef-desktop-source" };
const environment = { CI: "true", GITHUB_ACTIONS: "true", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_ENV: "/tmp/github-env", RUNNER_TEMP: "/tmp/runner", OWNER_BROWSER_CONFIRMATION: "owner-browser-disposable", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-server", SECRETS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64") };

test("connected-data helper requires an explicit GitHub-hosted disposable workspace before any runtime import or network", async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("must not connect"); };
  const old = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  try {
    for (const patch of [{ CI: "false" }, { GITHUB_ACTIONS: "false" }, { RUNNER_ENVIRONMENT: "self-hosted" }, { GITHUB_ENV: "" }, { RUNNER_TEMP: "relative" }, { OWNER_BROWSER_CONFIRMATION: "" }]) assert.throws(() => validateOwnerConnectedFixture(fixture, { ...environment, ...patch }), /Hosted disposable CI/);
    process.env.CI = "false";
    await assert.rejects(verifyOwnerConnectedData(["--fixture", "/should-not-read.json", "--report", "/should-not-write.json"]), /Hosted disposable CI/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
test("only the exact loopback API origin and synthetic browser fixture marker are accepted", () => {
  assert.equal(validateOwnerConnectedFixture(fixture, environment).origin, "http://127.0.0.1:54321");
  for (const url of ["https://project.supabase.co", "http://127.0.0.1:54321/another", "http://user:pass@127.0.0.1:54321", "http://127.0.0.1:54321/?redirect=other", "http://127.0.0.1"]) assert.throws(() => validateOwnerConnectedFixture(fixture, { ...environment, NEXT_PUBLIC_SUPABASE_URL: url }));
  for (const patch of [{ confirmation: "live" }, { partnerId: "other" }, { ownerId: null }, { runId: ".*" }, { marker: "someone-else" }, { marker: "owner-browser-123456abcdef-desktop-source/../../other" }]) assert.throws(() => validateOwnerConnectedFixture({ ...fixture, ...patch }, environment), /protected browser-created workspace/);
});
