import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { classifyContextFailure, notifyContextFailure, sanitizeContextDiagnostic, type ContextDiagnostic } from "../lib/auth/context-diagnostics.ts";
import { readCurrentServerUser } from "../lib/auth/session-check.ts";

const id = "21c6fc45-5219-405e-a92c-14f45ace9572", user = { id, email: "synthetic-private@invalid" };
type Client = Parameters<typeof readCurrentServerUser>[0];
function fixture(options: { authUser?: unknown; authError?: unknown; actor?: unknown; rpcError?: unknown; status?: number; throwAt?: "auth_user" | "session_actor" } = {}) {
  const calls: string[] = [];
  const client = {
    auth: { getUser: async () => { calls.push("auth_user"); if (options.throwAt === "auth_user") throw new Error("secret transport diagnostic"); return { data: { user: options.authUser === undefined ? user : options.authUser }, error: options.authError ?? null }; } },
    rpc: async (name: string) => { calls.push(name); if (options.throwAt === "session_actor") throw new Error("secret database diagnostic"); return { data: options.actor === undefined ? id : options.actor, error: options.rpcError ?? null, status: options.status ?? 200 }; },
  } as unknown as Client;
  return { calls, client };
}

test("diagnostics contain only fixed stage/kind, allowlisted code and bounded numeric status", () => {
  const events: ContextDiagnostic[] = [];
  const result = notifyContextFailure(event => { events.push(event); }, "session_actor", "unavailable", { code: "PGRST003", status: 503, message: "secret", user_id: id, token: "secret-token", rows: [user] });
  assert.deepEqual(result, { stage: "session_actor", kind: "unavailable", status: 503, code: "PGRST003" });
  assert.deepEqual(events, [result]); assert.equal(Object.isFrozen(result), true);
  assert.equal(JSON.stringify(result).includes("secret"), false); assert.equal(JSON.stringify(result).includes(id), false);
  for (const status of [99, 600, 401.5, NaN, Infinity, "503", undefined])
    assert.equal(notifyContextFailure(undefined, "auth_user", "unavailable", { code: "customer-identifier", status }).status, null);
  for (const status of [100, 200, 429, 599]) assert.equal(notifyContextFailure(undefined, "auth_user", "unavailable", undefined, status).status, status);
  assert.deepEqual(notifyContextFailure(undefined, "auth_user", "unavailable", { code: "token-injected", statusCode: 503 }), { stage: "auth_user", kind: "unavailable", status: 503, code: null });
});

test("serialization rejects malformed events and strips unrelated fields without invoking error getters", () => {
  const event = { stage: "primary_membership", kind: "unavailable", status: 500, code: "40001" };
  assert.deepEqual(sanitizeContextDiagnostic({ ...event, message: "secret", actor: id }), event);
  for (const patch of [{ stage: "private-id" }, { kind: "allowed" }, { status: "500" }, { status: 600 }, { code: "private-id" }, { code: undefined }])
    assert.equal(sanitizeContextDiagnostic({ ...event, ...patch }), null);
  for (const value of [null, [], {}, { ...event, status: undefined }]) assert.equal(sanitizeContextDiagnostic(value), null);
  const hostile = Object.defineProperties({}, Object.fromEntries(["status", "code", "name"].map(key => [key, { get() { throw new Error("secret getter"); } }])));
  assert.deepEqual(notifyContextFailure(undefined, "auth_user", "unavailable", hostile), { stage: "auth_user", kind: "unavailable", status: null, code: null });
  assert.equal(classifyContextFailure(hostile), "unavailable");
});

test("only known missing/invalid identity or permission failures are denied; genuine backend conditions stay unavailable", () => {
  for (const error of [{ name: "AuthSessionMissingError", status: 400 }, { name: "AuthInvalidJwtError" }, { code: "bad_jwt", status: 400 }, { code: "42501" }, { code: "PGRST301" }, { code: "PGRST302" }, { code: "PGRST303" }, { status: 401 }, { status: 403 }])
    assert.equal(classifyContextFailure(error), "denied");
  for (const error of [{ status: 503 }, { status: 429 }, { code: "40001", status: 409 }, { code: "40P01" }, { code: "PGRST003" }, { code: "PGRST202" }, new Error("secret"), { name: { toString() { throw new Error("must not coerce"); } } }])
    assert.equal(classifyContextFailure(error), "unavailable");
});

test("successful reads retain legacy identity shape and execute fresh Auth plus exact session RPC without caching", async () => {
  const f = fixture(), events: ContextDiagnostic[] = [];
  for (let i = 0; i < 2; i++) assert.deepEqual(await readCurrentServerUser(f.client, event => { events.push(event); }), { user, error: null });
  assert.deepEqual(f.calls, ["auth_user", "current_session_actor", "auth_user", "current_session_actor"]); assert.deepEqual(events, []);
});

test("Auth absence/invalid credential and backend failures preserve exact legacy result while recording the original stage", async () => {
  for (const [options, kind, status, code] of [
    [{ authUser: null }, "denied", null, null],
    [{ authError: { name: "AuthSessionMissingError", status: 400 } }, "denied", 400, null],
    [{ authError: { code: "bad_jwt", status: 401 } }, "denied", 401, "bad_jwt"],
    [{ authError: { code: "unexpected_failure", status: 503, message: "secret" } }, "unavailable", 503, "unexpected_failure"],
    [{ authError: { code: "over_request_rate_limit", status: 429 } }, "unavailable", 429, "over_request_rate_limit"],
  ] as const) {
    const f = fixture(options), events: ContextDiagnostic[] = [];
    assert.deepEqual(await readCurrentServerUser(f.client, event => { events.push(event); }), { user: null, error: "authError" in options ? "Your sign-in could not be verified. Sign in again." : null });
    assert.deepEqual(events, [{ stage: "auth_user", kind, status, code }]); assert.deepEqual(f.calls, ["auth_user"]);
  }
});

test("session RPC backend errors and malformed results remain unavailable; real permission and identity mismatch remain denied", async () => {
  for (const [options, kind, status, code] of [
    [{ rpcError: { code: "42501", message: "secret" }, status: 403 }, "denied", 403, "42501"],
    [{ rpcError: { code: "PGRST301" }, status: 401 }, "denied", 401, "PGRST301"],
    [{ rpcError: { code: "PGRST003" }, status: 504 }, "unavailable", 504, "PGRST003"],
    [{ rpcError: { code: "40001" }, status: 500 }, "unavailable", 500, "40001"],
    [{ rpcError: { code: "40P01" }, status: 500 }, "unavailable", 500, "40P01"],
    [{ actor: null }, "unavailable", 200, null], [{ actor: [id] }, "unavailable", 200, null],
    [{ actor: { id } }, "unavailable", 200, null], [{ actor: "different-user" }, "denied", 200, null],
  ] as const) {
    const f = fixture(options), events: ContextDiagnostic[] = [];
    assert.deepEqual(await readCurrentServerUser(f.client, event => { events.push(event); }), { user: null, error: "Your session has ended or could not be verified. Sign in again." });
    assert.deepEqual(events, [{ stage: "session_actor", kind, status, code }]); assert.deepEqual(f.calls, ["auth_user", "current_session_actor"]);
  }
});

test("throwing or rejecting observers cannot change fail-closed results or leak diagnostics", async () => {
  const f = fixture({ rpcError: { code: "PGRST003" }, status: 503 });
  const result = await readCurrentServerUser(f.client, event => { Object.assign(event, { stage: "secret", token: "secret" }); });
  assert.deepEqual(result, { user: null, error: "Your session has ended or could not be verified. Sign in again." });
  notifyContextFailure(async () => { throw new Error("observer failure"); }, "auth_user", "denied");
  await new Promise(resolve => setImmediate(resolve));
  for (const stage of ["auth_user", "session_actor"] as const) {
    const events: ContextDiagnostic[] = [];
    assert.deepEqual(await readCurrentServerUser(fixture({ throwAt: stage }).client, event => { events.push(event); throw new Error("observer failure"); }), { user: null, error: "Your session could not be verified. Try again shortly." });
    assert.deepEqual(events, [{ stage, kind: "unavailable", status: null, code: null }]);
  }
});

test("server wrappers forward the observer without changing unconfigured shape or the legacy sign-in redirect", () => {
  const program = `
   const Module=require('node:module'),original=Module._load,events=[];let mode='missing';
   const mocks={
    'next/navigation':{redirect:path=>{throw Object.assign(new Error('synthetic redirect'),{path});}},
    '@/lib/env':{isLocalDevAutoLoginEnabled:()=>false},
    '@/lib/supabase/server':{createSupabaseServerClient:async()=>mode==='missing'?null:{auth:{getUser:async()=>({data:{user:{id:'synthetic-owner'}},error:null})},rpc:async()=>({data:null,error:{code:'PGRST003'},status:503})}},
   };
   Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
   const auth=require('./lib/auth/session.ts');Module._load=original;
   (async()=>{const missing=await auth.getAuthState(e=>events.push(e));mode='backend';let redirect=null;try{await auth.requireAuthenticatedUser('/client',e=>events.push(e));}catch(e){redirect=e.path;}process.stdout.write(JSON.stringify({missing,redirect,events}));})().catch(()=>{process.exitCode=1});
  `;
  const result = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 }));
  assert.deepEqual(result.missing, { isSupabaseConfigured: false, user: null, error: null });
  assert.equal(result.redirect, "/login?next=%2Fclient");
  assert.deepEqual(result.events, [{ stage: "configuration", kind: "unavailable", status: null, code: null }, { stage: "session_actor", kind: "unavailable", status: 503, code: "PGRST003" }]);
});
