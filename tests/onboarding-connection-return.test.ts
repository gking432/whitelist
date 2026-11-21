import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { connectionCallbackPath, connectionOutcomeNotice, onboardingReturnHintForAuthCookie, onboardingReturnHintName } from "../lib/connections/onboarding-return.ts";

const attempt = "abcdefff-1111-4111-8111-111111111111";
const actor = "11111111-1111-4111-8111-111111111111";
const client = "22222222-2222-4222-8222-222222222222";
const partner = "33333333-3333-4333-8333-333333333333";
type Scenario = { body?: unknown; raw?: string; origin?: string | null; scope?: string | null; role?: string; impersonating?: boolean; denied?: boolean; portalActor?: string; missingAdmin?: boolean; missingClient?: boolean; rpcError?: string; rpcThrows?: boolean; malformed?: boolean; step?: string; finished?: boolean; unavailableProvider?: boolean; startThrows?: boolean; http?: boolean };
type Observation = { status: number; body: { url?: string; error?: string }; cache: string | null; cookies: { name: string; value: string; httpOnly?: boolean; secure?: boolean; sameSite?: string; path?: string; maxAge?: number }[]; calls: { context: boolean[]; admin: number; server: number; rpc: { name: string; args: Record<string, unknown> }[]; starts: { kind: string; scope: unknown; actor: string; provider?: string; connection?: string; permissions?: unknown }[]; order: string[]; network: number; effects: number } };
function route(scenario: Scenario = {}): Observation {
  const program = `
 const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)};
 const actor=${JSON.stringify(actor)},client=${JSON.stringify(client)},partner=${JSON.stringify(partner)},attempt=${JSON.stringify(attempt)},app=scenario.http?'http://127.0.0.1:3000':'https://app.synthetic.invalid';
 const calls={context:[],admin:0,server:0,rpc:[],starts:[],order:[],network:0,effects:0};
 globalThis.fetch=async()=>{calls.network++;throw Error('Blocked unmocked transport');};
 const snapshot={available:true,canEdit:true,profileRevision:'a'.repeat(32),answers:{description:'Saved owner fact'},progress:{revision:3,step:scenario.step||'connections',skipped:[],finished:scenario.finished||false}};
 const admin={from(){throw Error('Unexpected administration query');},rpc(){throw Error('Unexpected administration RPC');}};
 const start=(kind,cookiePrefix)=>(...args)=>{const [provided,scope,user,...rest]=args;if(provided!==admin)throw Error('Wrong trusted client');calls.order.push('start');calls.starts.push({kind,scope,actor:user,...(kind==='workspace'?{provider:rest[0],connection:rest[1]}:{connection:rest[0],permissions:rest[1]})});if(scenario.startThrows)throw Error('private provider configuration');return Promise.resolve({cookieName:cookiePrefix+'_'+attempt,cookie:'synthetic-auth-cookie',url:'https://provider.synthetic.invalid/authorize?state=synthetic-only'});};
 const mocks={
  '@/lib/env':{getAppUrl:()=>app},
  '@/lib/connections/context':{connectionsContext:async write=>{calls.context.push(write);calls.order.push('context');return scenario.denied?null:{user:{id:actor},scope:{partnerId:partner,clientId:client},portal:{user:{id:scenario.portalActor||actor},access:{role:scenario.role||'client_owner',isImpersonating:!!scenario.impersonating}}};}},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{calls.admin++;return scenario.missingAdmin?null:admin;}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.server++;calls.order.push('server');return scenario.missingClient?null:{rpc:async(name,args)=>{calls.rpc.push({name,args});calls.order.push('rpc');if(name!=='get_owner_onboarding'||args.p_client!==client||Object.keys(args).length!==1)throw Error('Wrong derived setup scope');if(scenario.rpcThrows)throw Error('private transport diagnostic');return scenario.rpcError?{data:null,error:{code:scenario.rpcError,message:'private database diagnostic'}}:{data:scenario.malformed?{...snapshot,connected:true}:snapshot,error:null};}};}},
  '@/lib/connections/oauth':{startReadOnlyOAuth:start('workspace','workspace_read'),startGooglePermissionUpgrade:start('upgrade','workspace_permissions')},
  '@/lib/connections/hubspot-oauth':{startHubSpotOAuth:start('hubspot','hubspot_oauth')},
  '@/lib/connections/data':{readConnectedData:async()=>{throw Error('Unexpected data load');}},
  '@/lib/business/access':{canWriteBusinessWorkspace:()=>true},
  '@/lib/connections/provider-options':{readOwnerProviderOptions:()=>['google_workspace','microsoft_365','hubspot','stripe','generic_inbound_webhook'].map(key=>({key,available:!scenario.unavailableProvider,detail:'Synthetic setup option'}))},
  '@/lib/connections/intake-setup':{prepareOwnerIntake:async()=>{calls.effects++;throw Error('Unexpected intake setup');}},
  '@/lib/connections/provider-setup':{prepareStripeSetup:async()=>{calls.effects++;throw Error('Unexpected Stripe setup');}},
  '@/lib/integrations/connectors/sync-runner':{enqueueInitialConnectorSync:async()=>{calls.effects++;},processConnectorSyncJobs:async()=>{calls.effects++;}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};const {POST}=require('./app/api/connections/route.ts');Module._load=original;
 const {NextRequest}=require('next/server');const headers={...(scenario.origin===null?{}:{origin:scenario.origin||app}),...(scenario.scope===null?{}:{'X-Workstation-Scope':scenario.scope||actor+':'+client})};
 const request=new NextRequest(app+'/api/connections?clientId=foreign&actorId=other',{method:'POST',headers,body:scenario.raw===undefined?JSON.stringify(scenario.body||{action:'connect',provider:'google_workspace',returnTo:'onboarding'}):scenario.raw});
 POST(request).then(async response=>process.stdout.write(JSON.stringify({status:response.status,body:await response.json(),cache:response.headers.get('cache-control'),cookies:response.cookies.getAll().map(({name,value,httpOnly,secure,sameSite,path,maxAge})=>({name,value,httpOnly,secure,sameSite,path,maxAge})),calls}))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as Observation;
}
function noStart(value: Observation) { assert.deepEqual(value.calls.starts, []); assert.equal(value.calls.effects, 0); assert.equal(value.calls.network, 0); assert.deepEqual(value.cookies, []); }

test("return hints accept only full attempt UUIDs and the three exact OAuth cookie prefixes", () => {
  assert.equal(onboardingReturnHintName(attempt.toUpperCase()), `onboarding_return_${attempt}`);
  for (const value of [null, undefined, {}, "", "not-a-uuid", `${attempt}/next`, `${attempt};other=onboarding`]) assert.equal(onboardingReturnHintName(value), null);
  for (const prefix of ["workspace_read", "workspace_permissions", "hubspot_oauth"]) assert.equal(onboardingReturnHintForAuthCookie(`${prefix}_${attempt}`), `onboarding_return_${attempt}`);
  for (const value of [`other_${attempt}`, `workspace_read_${attempt}.0`, `workspace_read_${attempt}_extra`, "workspace_read_not-a-uuid", attempt]) assert.equal(onboardingReturnHintForAuthCookie(value), null);
});
test("callback destinations and notices are fixed feedback and never treat query text as saved connection proof", () => {
  assert.equal(connectionCallbackPath("onboarding"), "/client/onboarding");
  for (const value of [undefined, null, {}, "https://evil.invalid", "//evil.invalid", "/client/onboarding", "ONBOARDING", "onboarding?next=/control"]) assert.equal(connectionCallbackPath(value), "/client/apps");
  for (const outcome of ["connected", "permissions_updated"]) assert.match(connectionOutcomeNotice(outcome)!, /Check the saved connection status/);
  assert.match(connectionOutcomeNotice("sync_pending")!, /could not be started/);
  for (const outcome of ["denied", "permissions_denied", "expired", "permissions", "permissions_failed", "permissions_changed", "changed", "failed", "unavailable", "sign_in_required"]) assert.ok(connectionOutcomeNotice(outcome));
  for (const value of [null, {}, "", "arbitrary sensitive diagnostic", "<script>connected</script>"]) assert.equal(connectionOutcomeNotice(value), undefined);
});
test("actual connections route reads the exact saved owner step before starting one supported provider and sets only its attempt hint", () => {
  for (const provider of ["google_workspace", "microsoft_365", "hubspot"]) {
    const result = route({ body: { action: "connect", provider, returnTo: "onboarding" } });
    assert.equal(result.status, 200); assert.equal(result.cache, "no-store");
    assert.deepEqual(result.calls.context, [true]); assert.equal(result.calls.server, 1);
    assert.deepEqual(result.calls.rpc, [{ name: "get_owner_onboarding", args: { p_client: client } }]);
    assert.deepEqual(result.calls.order, ["context", "server", "rpc", "start"]);
    assert.equal(result.calls.starts.length, 1); assert.deepEqual(result.calls.starts[0].scope, { partnerId: partner, clientId: client }); assert.equal(result.calls.starts[0].actor, actor);
    assert.equal(result.calls.starts[0].kind, provider === "hubspot" ? "hubspot" : "workspace");
    if (provider !== "hubspot") assert.equal(result.calls.starts[0].provider, provider);
    const hint = result.cookies.find(value => value.name.startsWith("onboarding_return_"));
    assert.deepEqual(hint, { name: `onboarding_return_${attempt}`, value: "onboarding", httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 900 });
    assert.equal(result.cookies.length, 2); assert.equal(result.calls.effects, 0); assert.equal(result.calls.network, 0);
  }
  const loopback = route({ http: true }); assert.equal(loopback.cookies.find(value => value.name.startsWith("onboarding_return_"))?.secure, false);
});
test("explicit onboarding return requires origin, mandatory current scope, exact portal actor, owner and non-impersonation before RPC or provider start", () => {
  for (const scenario of [{ origin: null }, { origin: "https://foreign.invalid" }, { scope: null }, { scope: `other:${client}` }, { scope: `${actor}:foreign` }, { portalActor: "other" }, { role: "client_manager" }, { role: "client_viewer" }, { impersonating: true }, { denied: true }]) {
    const result = route(scenario); assert.equal(result.status, 403); noStart(result); assert.equal(result.calls.server, 0); assert.equal(result.calls.rpc.length, 0);
    if ("origin" in scenario) assert.deepEqual(result.calls.context, []);
  }
});
test("only the three onboarding OAuth providers pass; arbitrary return URLs, extra scope and malformed requests never start setup", () => {
  for (const provider of ["stripe", "generic_inbound_webhook"]) {
    const result = route({ body: { action: "connect", provider, returnTo: "onboarding" } }); assert.equal(result.status, 422); noStart(result); assert.equal(result.calls.server, 0);
  }
  for (const body of [{ action: "connect", provider: "google_workspace", returnTo: "https://evil.invalid" }, { action: "connect", provider: "google_workspace", returnTo: "/client/onboarding" }, { action: "connect", provider: "google_workspace", returnTo: "onboarding", clientId: client }, { action: "connect", provider: "google_workspace", returnTo: "onboarding", actorId: actor }]) {
    const result = route({ body }); assert.equal(result.status, 400); noStart(result); assert.equal(result.calls.server, 0);
  }
  assert.equal(route({ raw: "not-json" }).status, 400); const oversized = route({ raw: " ".repeat(4001) }); assert.equal(oversized.status, 413); noStart(oversized);
});
test("saved access denial is403, stale presentation409 and malformed/unavailable/backend results503 without a second RPC or provider start", () => {
  const denied = route({ rpcError: "42501" }); assert.equal(denied.status, 403); noStart(denied); assert.equal(denied.calls.rpc.length, 1);
  for (const scenario of [{ step: "review" }, { step: "done", finished: true }]) {
    const result = route(scenario); assert.equal(result.status, 409); noStart(result); assert.equal(result.calls.rpc.length, 1);
  }
  for (const scenario of [{ missingAdmin: true }, { missingClient: true }, { malformed: true }, { step: "connections", finished: true }, { rpcThrows: true }, ...["40001", "40P01", "PGRST003", "08006"].map(rpcError => ({ rpcError }))]) {
    const result = route(scenario); assert.equal(result.status, 503); noStart(result); assert.ok(result.calls.rpc.length <= 1); assert.doesNotMatch(JSON.stringify(result.body), /private|40001|40P01|PGRST|08006/);
  }
});
test("legacy connects without explicit return skip onboarding reads and never set a navigation hint", () => {
  for (const provider of ["google_workspace", "microsoft_365", "hubspot"]) {
    const result = route({ scope: null, body: { action: "connect", provider } }); assert.equal(result.status, 200);
    assert.equal(result.calls.server, 0); assert.deepEqual(result.calls.rpc, []); assert.equal(result.calls.starts.length, 1);
    assert.equal(result.cookies.length, 1); assert.ok(!result.cookies[0].name.startsWith("onboarding_return_")); assert.equal(connectionCallbackPath(undefined), "/client/apps"); assert.equal(result.calls.effects, 0); assert.equal(result.calls.network, 0);
  }
});
test("provider unavailability or an interrupted start cannot create a success hint or schedule imports", () => {
  const unavailable = route({ unavailableProvider: true }); assert.equal(unavailable.status, 503); noStart(unavailable); assert.equal(unavailable.calls.rpc.length, 1);
  const interrupted = route({ startThrows: true }); assert.equal(interrupted.status, 400); assert.equal(interrupted.calls.starts.length, 1); assert.deepEqual(interrupted.cookies, []); assert.equal(interrupted.calls.effects, 0); assert.equal(interrupted.calls.network, 0); assert.doesNotMatch(JSON.stringify(interrupted.body), /private/);
});
