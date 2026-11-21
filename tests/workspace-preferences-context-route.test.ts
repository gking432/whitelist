import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = { method?: "GET" | "POST"; kind?: "denied" | "unavailable"; diagnostic?: unknown; impersonating?: boolean; cookie?: string; origin?: string; unavailableSnapshot?: boolean; rpcCode?: string };
function route(scenario: Scenario) {
  const program = `
    const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},calls={context:[],snapshot:0,client:0,rpc:[]};
    process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321';
    const mocks={
      '@/lib/env':{getAppUrl:()=> 'http://127.0.0.1:3000'},
      '@/lib/connections/context':{connectionsContextDecision:async(write)=>{calls.context.push(write);return scenario.kind?{kind:scenario.kind,diagnostic:scenario.diagnostic||{stage:'auth_user',kind:scenario.kind,status:null,code:null}}:{kind:'ok',context:{user:{id:'actual-owner'},scope:{clientId:'actual-business'},portal:{client:{id:'actual-business'},access:{isImpersonating:!!scenario.impersonating}}}};}},
      '@/lib/business/workspace-preferences-data':{loadWorkspacePersonalization:async portal=>{calls.snapshot++;if(portal.client.id!=='actual-business')throw Error('wrong tenant');return {available:!scenario.unavailableSnapshot,canEdit:true,preferences:{revision:3},activity:[]};}},
      '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;return {rpc:async(name,args)=>{calls.rpc.push({name,args});return scenario.rpcCode?{error:{code:scenario.rpcCode,message:'private-backend'}}:{data:{revision:4}};}};}},
    };
    Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
    const handler=require('./app/api/business/workspace-preferences/route.ts');Module._load=original;
    const {NextRequest}=require('next/server');
    const request=new NextRequest('http://127.0.0.1:3000/api/business/workspace-preferences?clientId=foreign&actorId=foreign',{
      method:scenario.method||'GET',headers:{origin:scenario.origin||'http://127.0.0.1:3000',cookie:scenario.cookie||'',...(scenario.method==='POST'?{'content-type':'application/json'}:{})},
      ...(scenario.method==='POST'?{body:JSON.stringify({action:'reset',requestKey:'11111111-1111-4111-8111-111111111111',revision:3})}:{})});
    handler[scenario.method||'GET'](request).then(async response=>process.stdout.write(JSON.stringify({status:response.status,body:await response.json(),cache:response.headers.get('cache-control'),context:response.headers.get('x-workspace-context'),calls}))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    status: number; body: { error?: string; available?: boolean }; cache: string; context: string | null;
    calls: { context: boolean[]; snapshot: number; client: number; rpc: { name: string; args: Record<string, unknown> }[] };
  };
}

test("preference context denial and temporary failure remain distinct with no data access or retry", () => {
  for (const method of ["GET", "POST"] as const) for (const kind of ["denied", "unavailable"] as const) {
    const diagnostic = { stage: "session_actor", kind, status: kind === "denied" ? 403 : 504, code: kind === "denied" ? "42501" : "PGRST003" };
    const result = route({ method, kind, diagnostic });
    assert.equal(result.status, kind === "denied" ? 403 : 503);
    assert.equal(result.cache, "no-store"); assert.deepEqual(result.calls, { context: [false], snapshot: 0, client: 0, rpc: [] });
    assert.deepEqual(JSON.parse(result.context!), { ...diagnostic, possibleSessionCookie: false });
    assert.deepEqual(Object.keys(result.body), ["error"]);
    assert.equal(result.body.error, kind === "denied" ? "Business workspace access is required." : method === "GET" ? "Your preferences could not be loaded. Try again." : "The data service is unavailable.");
  }
});

test("original response metadata strips secrets and treats a cookie carrier only as a hint", () => {
  const diagnostic = { stage: "auth_user", kind: "denied", status: 401, code: "invalid_jwt", token: "private-secret", userId: "private-actor", tenant: "private-tenant" };
  const denied = route({ kind: "denied", diagnostic, cookie: "sb-127-auth-token.0=private-secret; sb-127-auth-token.1=more-secret" });
  assert.equal(denied.status, 403); assert.deepEqual(JSON.parse(denied.context!), { stage: "auth_user", kind: "denied", status: 401, code: "invalid_jwt", possibleSessionCookie: true });
  assert.doesNotMatch(JSON.stringify(denied), /private-secret|private-actor|private-tenant|more-secret/);
  const malformed = route({ kind: "unavailable", diagnostic: { stage: "private-secret", kind: "unavailable", status: 503, code: "private-secret" }, cookie: "sb-127-auth-token.1=private-secret" });
  assert.equal(malformed.status, 503); assert.deepEqual(JSON.parse(malformed.context!), { stage: "configuration", kind: "unavailable", status: null, code: null, possibleSessionCookie: false });
});

test("real preferences keep read authorization, server tenant and impersonation/origin guards", () => {
  for (const method of ["GET", "POST"] as const) {
    const result = route({ method }); assert.equal(result.status, 200); assert.equal(result.context, null); assert.deepEqual(result.calls.context, [false]);
    assert.equal(result.calls.snapshot, method === "GET" ? 1 : 0); assert.equal(result.calls.client, method === "POST" ? 1 : 0);
    if (method === "POST") { assert.equal(result.calls.rpc[0].args.p_client, "actual-business"); assert.equal("p_actor" in result.calls.rpc[0].args, false); }
    const denied = route({ method, impersonating: true }); assert.equal(denied.status, 403); assert.equal(denied.calls.snapshot, 0); assert.equal(denied.calls.client, 0); assert.equal(JSON.parse(denied.context!).stage, "impersonation");
  }
  const foreign = route({ method: "POST", origin: "https://foreign.invalid" }); assert.equal(foreign.status, 403); assert.deepEqual(foreign.calls.context, []); assert.equal(foreign.context, null);
  const unavailable = route({ unavailableSnapshot: true }); assert.equal(unavailable.status, 503); assert.equal(unavailable.context, null);
  const conflict = route({ method: "POST", rpcCode: "PT409" }); assert.equal(conflict.status, 409); assert.equal(conflict.context, null); assert.equal(conflict.calls.rpc.length, 1);
});
