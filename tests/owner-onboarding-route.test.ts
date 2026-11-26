import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const key = "11111111-1111-4111-8111-111111111111";
type Scenario = { method?: "GET" | "POST"; origin?: string; scope?: string | null; role?: string; impersonating?: boolean; decision?: "denied" | "unavailable"; code?: string; thrown?: boolean; malformed?: boolean; raw?: string; body?: unknown; contentLength?: string };
function route(scenario: Scenario) {
  const program = `
 const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},calls={context:[],client:0,rpc:[]};
 const snapshot={available:true,canEdit:true,profileRevision:'2026-11-21T01:00:00+00:00',answers:{description:'Actual saved owner words'},progress:{revision:2,step:'connections',skipped:[],finished:false}};
 const mocks={
  '@/lib/env':{getAppUrl:()=> 'http://127.0.0.1:3000'},
  '@/lib/connections/context':{connectionsContextDecision:async write=>{calls.context.push(write);return scenario.decision?{kind:scenario.decision,diagnostic:{stage:'auth_user',kind:scenario.decision,status:null,code:null}}:{kind:'ok',context:{user:{id:'actual-owner'},scope:{clientId:'actual-business'},portal:{access:{role:scenario.role||'client_owner',isImpersonating:!!scenario.impersonating}}}};}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;return {rpc:async(name,args)=>{calls.rpc.push({name,args});if(scenario.thrown)throw Error('private transport');return scenario.code?{error:{code:scenario.code,message:'private diagnostic'}}:{data:scenario.malformed?{progress:{finished:true}}:name==='get_owner_onboarding'?snapshot:{snapshot,result:{id:'22222222-2222-4222-8222-222222222222',key:args.p_key,revision:2,profileRevision:snapshot.profileRevision,replayed:false,cancelledWork:0}}};}};}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};const handler=require('./app/api/business/onboarding/route.ts');Module._load=original;
 const {NextRequest}=require('next/server');const method=scenario.method||'GET';
 const request=new NextRequest('http://127.0.0.1:3000/api/business/onboarding?clientId=foreign&actorId=other',{method,headers:{origin:scenario.origin||'http://127.0.0.1:3000',...(scenario.scope===null?{}:{'X-Workstation-Scope':scenario.scope||'actual-owner:actual-business'}),...(scenario.contentLength?{'content-length':scenario.contentLength}:{})},...(method==='POST'?{body:scenario.raw===undefined?JSON.stringify(scenario.body||{action:'answer',key:${JSON.stringify(key)},revision:1,field:'description',value:'  Owner supplied words  ',expectedProfileRevision:'unconfigured'}):scenario.raw}:{})});
 handler[method](request).then(async response=>process.stdout.write(JSON.stringify({status:response.status,body:await response.json(),cache:response.headers.get('cache-control'),vary:response.headers.get('vary'),calls}))).catch(error=>{process.stderr.write(error.message);process.exitCode=1});
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    status: number; body: { error?: string; progress?: { step: string }; result?: { replayed: boolean } }; cache: string; vary: string;
    calls: { context: boolean[]; client: number; rpc: { name: string; args: Record<string, unknown> }[] };
  };
}
test("onboarding uses the fresh owner scope, authenticated client and one atomic normalized command", () => {
  const get = route({}); assert.equal(get.status, 200); assert.equal(get.body.progress?.step, "connections"); assert.equal(get.cache, "no-store"); assert.match(get.vary, /X-Workstation-Scope/); assert.deepEqual(get.calls.context, [true]);
  const post = route({ method: "POST" }); assert.equal(post.status, 200); assert.deepEqual(post.calls.context, [true]); assert.equal(post.calls.client, 1);
  assert.deepEqual(post.calls.rpc, [{ name: "save_owner_onboarding", args: { p_client: "actual-business", p_key: key, p_revision: 1, p_command: { action: "answer", field: "description", value: "Owner supplied words", expectedProfileRevision: "unconfigured" } } }]);
});
test("stale rendered scope, non-owner, impersonation and missing identity cannot read or write setup", () => {
  for (const method of ["GET", "POST"] as const) for (const scenario of [{ scope: null }, { scope: "other:actual-business" }, { scope: "actual-owner:other" }, { role: "client_viewer" }, { role: "client_manager" }, { impersonating: true }, { decision: "denied" as const }]) {
    const result = route({ method, ...scenario }); assert.equal(result.status, 403); assert.equal(result.calls.client, 0); assert.deepEqual(result.calls.rpc, []);
  }
  const origin = route({ method: "POST", origin: "https://foreign.invalid" }); assert.equal(origin.status, 403); assert.deepEqual(origin.calls.context, []);
});
test("onboarding separates conflict, permission, input and genuine backend failures without retry or private diagnostics", () => {
  for (const [code, status] of [["PT409", 409], ["42501", 403], ["22023", 422], ["40001", 503], ["40P01", 503], ["PGRST003", 503]] as const) {
    const result = route({ method: "POST", code }); assert.equal(result.status, status); assert.equal(result.calls.rpc.length, 1); assert.doesNotMatch(JSON.stringify(result.body), /private|40001|40P01|PGRST/);
  }
  for (const method of ["GET", "POST"] as const) {
    assert.equal(route({ method, decision: "unavailable" }).status, 503);
    assert.equal(route({ method, malformed: true }).status, 503);
    const thrown = route({ method, thrown: true }); assert.equal(thrown.status, 503); assert.equal(thrown.calls.rpc.length, 1); assert.doesNotMatch(JSON.stringify(thrown.body), /private/);
  }
});
test("only bounded description and fixed presentation commands reach the database", () => {
  const body = { action: "navigate", key, revision: 0, step: "done" };
  assert.equal(route({ method: "POST", body }).status, 200);
  for (const value of [{ ...body, actorId: key }, { ...body, clientId: key }, { ...body, step: "//foreign.invalid" }, { ...body, action: "set_authority" }, { ...body, action: "skip" }, { action: "answer", key, revision: 0, field: "goals", value: ["invented"], expectedProfileRevision: "unconfigured" }]) {
    const result = route({ method: "POST", body: value }); assert.equal(result.status, 400); assert.equal(result.calls.rpc.length, 0);
  }
  for (const scenario of [{ raw: "not JSON" }, { contentLength: "16385" }, { raw: " ".repeat(16385) }]) {
    const result = route({ method: "POST", ...scenario }); assert.ok([400, 413].includes(result.status)); assert.equal(result.calls.rpc.length, 0);
  }
});
