import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { ContextDiagnostic } from "../lib/auth/context-diagnostics.ts";

type Event = { stage: ContextDiagnostic["stage"]; kind: ContextDiagnostic["kind"]; error?: { code?: string; status?: number; message?: string; token?: string }; status?: number };
type Scenario = { legacy?: boolean; write?: boolean; configured?: boolean; userMissing?: boolean; authThrow?: boolean; authEvent?: Event; portalEvents?: Event[]; portal?: "ok" | "denied" | "unavailable"; portalThrow?: boolean; missingClient?: boolean; portalActor?: string; role?: string; missingSection?: boolean; cannotWrite?: boolean; impersonating?: boolean; requestedActor?: string; requestedClient?: string };
type Result = { result?: { kind?: string; diagnostic?: ContextDiagnostic; context?: { user: { id: string }; scope: { partnerId: string; clientId: string } }; user?: { id: string }; scope?: { partnerId: string; clientId: string } } | null; thrown?: string; calls: { auth: number[]; portal: number[] } };
function resolve(scenario: Scenario): Result {
  const program = `
  const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},calls={auth:[],portal:[]};
  const {notifyContextFailure}=require('./lib/auth/context-diagnostics.ts');
  const emit=(observer,event)=>{if(event)notifyContextFailure(observer,event.stage,event.kind,event.error,event.status);};
  const mocks={
    '@/lib/auth/session':{getAuthState:async function(observer){calls.auth.push(arguments.length);emit(observer,scenario.authEvent);if(scenario.authThrow)throw new Error('original legacy auth exception');return {isSupabaseConfigured:scenario.configured!==false,user:scenario.userMissing||scenario.configured===false?null:{id:'fresh-owner'},error:null};}},
    '@/lib/clients/portal':{loadClientPortal:async function(observer){calls.portal.push(arguments.length);for(const event of scenario.portalEvents||[])emit(observer,event);if(scenario.portalThrow)throw new Error('original legacy portal exception');if(scenario.portal&&scenario.portal!=='ok')return {kind:scenario.portal};return {kind:'ok',user:{id:scenario.portalActor||'fresh-owner'},client:scenario.missingClient?undefined:{id:'verified-business',partner_id:'verified-partner'},access:{userId:'fresh-owner',clientId:'verified-business',partnerId:'verified-partner',role:scenario.role||'client_owner',visibleClientSections:scenario.missingSection?['settings']:['settings','marketing','tasks','contacts','automations','action-center'],canEditClientData:!scenario.cannotWrite,canOperateCustomerActions:true,canResolveApprovals:true,isImpersonating:!!scenario.impersonating},branding:{}};}},
  };
  Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
  const api=require('./lib/connections/context.ts');Module._load=original;
  (scenario.legacy?api.connectionsContext(scenario.write):api.connectionsContextDecision(scenario.write)).then(result=>process.stdout.write(JSON.stringify({result,calls})),error=>process.stdout.write(JSON.stringify({thrown:error.message,calls})));
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as Result;
}

test("detailed context uses fresh verified identity and portal scope once, never supplied actor or client", () => {
  for (const write of [false, true]) {
    const value = resolve({ write, requestedActor: "foreign-owner", requestedClient: "foreign-business" });
    assert.equal(value.result?.kind, "ok"); assert.deepEqual(value.result?.context?.scope, { partnerId: "verified-partner", clientId: "verified-business" }); assert.equal(value.result?.context?.user.id, "fresh-owner");
    assert.deepEqual(value.calls, { auth: [1], portal: [1] }); assert.equal(value.thrown, undefined);
  }
});
test("auth service and session RPC failures remain unavailable with the original sanitized stage", () => {
  for (const event of [{ stage: "auth_user", kind: "unavailable", error: { status: 503, code: "unexpected_failure", message: "private bearer secret", token: "sensitive" } }, { stage: "session_actor", kind: "unavailable", error: { status: 504, code: "PGRST003", message: "private query details" } }] as const) {
    const value = resolve({ userMissing: true, authEvent: event });
    assert.equal(value.result?.kind, "unavailable"); assert.equal(value.result?.diagnostic?.stage, event.stage); assert.equal(value.result?.diagnostic?.kind, "unavailable"); assert.equal(value.result?.diagnostic?.status, event.error.status);
    if (event.stage === "session_actor") assert.equal(value.result?.diagnostic?.code, "PGRST003");
    assert.deepEqual(value.calls, { auth: [1], portal: [] }); assert.doesNotMatch(JSON.stringify(value), /private bearer|sensitive|private query|message|token/);
  }
  const configuration = resolve({ configured: false }); assert.equal(configuration.result?.kind, "unavailable"); assert.equal(configuration.result?.diagnostic?.stage, "configuration");
  const absent = resolve({ userMissing: true }); assert.equal(absent.result?.kind, "denied"); assert.equal(absent.result?.diagnostic?.stage, "auth_user"); assert.deepEqual(absent.calls.portal, []);
});
test("portal unavailability is distinct from denial and retains the first actual failed lookup", () => {
  const events: Event[] = [{ stage: "primary_membership", kind: "unavailable", error: { code: "PGRST003", status: 504, message: "private SQL" } }, { stage: "portal_access", kind: "unavailable", error: { code: "42501", status: 403 } }];
  const value = resolve({ portal: "unavailable", portalEvents: events });
  assert.equal(value.result?.kind, "unavailable"); assert.deepEqual(value.result?.diagnostic, { stage: "primary_membership", kind: "unavailable", status: 504, code: "PGRST003" }); assert.deepEqual(value.calls, { auth: [1], portal: [1] });
  for (const kind of ["denied", "unavailable"] as const) { const fallback = resolve({ portal: kind }); assert.equal(fallback.result?.kind, kind); assert.equal(fallback.result?.diagnostic?.stage, "portal_access"); assert.equal(fallback.result?.context, undefined); }
});
test("cross-role, missing sections and write impersonation do not gain context", () => {
  for (const scenario of [{ role: "client_viewer" }, { role: "client_staff" }, { role: "partner_owner" }, { missingSection: true }, { write: true, cannotWrite: true }]) {
    const value = resolve(scenario); assert.equal(value.result?.kind, "denied"); assert.equal(value.result?.diagnostic?.stage, "workspace_sections"); assert.equal(value.result?.context, undefined);
  }
  const impersonating = resolve({ write: true, impersonating: true }); assert.equal(impersonating.result?.kind, "denied"); assert.equal(impersonating.result?.diagnostic?.stage, "impersonation");
  assert.equal(resolve({ cannotWrite: true }).result?.kind, "ok", "A read decision does not acquire write authority.");
  assert.equal(resolve({ impersonating: true }).result?.kind, "ok", "Read impersonation retains the existing resolver boundary; the preference route must explicitly reject it.");
});
test("unknown exceptions and incomplete portal data fail unavailable while mixed actors fail denied", () => {
  for (const scenario of [{ authThrow: true }, { portalThrow: true }, { missingClient: true }]) {
    const value = resolve(scenario); assert.equal(value.result?.kind, "unavailable"); assert.equal(value.result?.context, undefined); assert.equal(value.thrown, undefined); assert.doesNotMatch(JSON.stringify(value.result), /original legacy/);
    assert.equal(value.calls.auth.length, 1); assert.ok(value.calls.portal.length <= 1);
  }
  const mixed = resolve({ portalActor: "other-owner" }); assert.equal(mixed.result?.kind, "denied"); assert.equal(mixed.result?.diagnostic?.stage, "portal_access"); assert.equal(mixed.result?.context, undefined);
});
test("legacy resolver retains zero-observer calls, null/shape behavior and original thrown errors", () => {
  const valid = resolve({ legacy: true }); assert.equal(valid.result?.kind, undefined); assert.equal(valid.result?.user?.id, "fresh-owner"); assert.deepEqual(valid.result?.scope, { partnerId: "verified-partner", clientId: "verified-business" }); assert.deepEqual(valid.calls, { auth: [0], portal: [0] });
  for (const scenario of [{ configured: false }, { userMissing: true }, { portal: "unavailable" }, { portal: "denied" }, { role: "client_viewer" }, { write: true, impersonating: true }]) {
    const value = resolve({ ...scenario, legacy: true } as Scenario); assert.equal(value.result, null); assert.ok(value.calls.auth.every((count) => count === 0) && value.calls.portal.every((count) => count === 0));
  }
  for (const scenario of [{ authThrow: true }, { portalThrow: true }]) { const value = resolve({ ...scenario, legacy: true }); assert.match(value.thrown!, /original legacy (auth|portal) exception/); assert.equal(value.result, undefined); }
});
