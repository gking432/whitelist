import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const key = "11111111-1111-4111-8111-111111111111";
type Scenario = { method?: "GET" | "POST"; body?: unknown; raw?: string; origin?: string | null; denied?: boolean; impersonating?: boolean; code?: string; malformedReceipt?: boolean; scope?: string | null; currentClient?: string; currentActor?: string };
function route(scenario: Scenario) {
  const program = `
 const Module=require('node:module'), original=Module._load, scenario=${JSON.stringify(scenario)}, calls={context:0,client:0,rpc:[]};
 const mocks={
  '@/lib/env':{getAppUrl:()=> 'http://127.0.0.1:3000'},
  '@/lib/connections/context':{connectionsContext:async()=>{calls.context++;return scenario.denied?null:{user:{id:scenario.currentActor||'actual-owner'},scope:{clientId:scenario.currentClient||'actual-business'},portal:{access:{isImpersonating:!!scenario.impersonating}}};}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;return {rpc:async(name,args)=>{calls.rpc.push({name,args});const settings=args.p_settings||{answer:'unanswered',assistant:null};return scenario.code?{error:{code:scenario.code,message:'private diagnostic'}}:{data:scenario.malformedReceipt?{connected:true}:{preferences:{...settings,revision:args.p_revision===undefined?0:args.p_revision+1},available:true,canEdit:true}};}};}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
 const handler=require('./app/api/business/personal-assistant/route.ts');Module._load=original;
 const request=new Request('http://127.0.0.1:3000/api/business/personal-assistant?clientId=foreign&actorId=other',{method:'POST',headers:{...(scenario.origin===null?{}:{Origin:scenario.origin||'http://127.0.0.1:3000'}),'Content-Type':'application/json',...(scenario.scope===null?{}:{'X-Workstation-Scope':scenario.scope||'actual-owner:actual-business'})},body:scenario.raw===undefined?JSON.stringify(scenario.body||{key:${JSON.stringify(key)},revision:0,settings:{answer:'yes',assistant:'muse'}}):scenario.raw});
 (scenario.method==='GET'?handler.GET(request):handler.POST(request)).then(async response=>process.stdout.write(JSON.stringify({status:response.status,body:await response.json(),cache:response.headers.get('cache-control'),vary:response.headers.get('vary'),calls}))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as { status: number; body: { error?: string; connection?: { state: string; canChat: boolean }; preferences?: { revision: number } }; cache: string; vary: string; calls: { context: number; client: number; rpc: { name: string; args: Record<string, unknown> }[] } };
}
test("personal preference API uses the signed-in business and authenticated RPC only", () => {
  for (const method of ["GET", "POST"] as const) {
    const result = route({ method }); assert.equal(result.status, 200); assert.equal(result.cache, "no-store"); assert.equal(result.vary, "Cookie");
    assert.equal(result.calls.rpc.length, 1); assert.equal(result.calls.rpc[0].args.p_client, "actual-business"); assert.equal(result.body.connection?.canChat, false);
    assert.equal(result.calls.rpc[0].name, method === "GET" ? "get_owner_personal_assistant" : "save_owner_personal_assistant");
    assert.equal("p_actor" in result.calls.rpc[0].args, false); assert.equal(result.body.connection?.state, method === "GET" ? "not_selected" : "unavailable");
  }
});
test("preference API rejects origin, missing access and impersonation without a mutation", () => {
  for (const scenario of [{ origin: null }, { origin: "https://unrelated.invalid" }, { denied: true }, { impersonating: true }]) {
    const result = route(scenario); assert.equal(result.status, 403); assert.equal(result.calls.rpc.length, 0);
  }
  for (const scenario of [{ denied: true }, { impersonating: true }]) assert.equal(route({ method: "GET", ...scenario }).status, 403);
});
test("strict actual body bounds reject actor, tenant and connection injection", () => {
  const valid = { key, revision: 0, settings: { answer: "yes", assistant: "muse" } };
  for (const body of [{ ...valid, actorId: key }, { ...valid, clientId: key }, { ...valid, settings: { ...valid.settings, connected: true } }, { ...valid, settings: { answer: "yes", assistant: null } }]) {
    const result = route({ body }); assert.equal(result.status, 400); assert.equal(result.calls.rpc.length, 0);
  }
  assert.equal(route({ raw: "not JSON" }).status, 400);
  const oversized = route({ raw: " ".repeat(4097) }); assert.equal(oversized.status, 413); assert.equal(oversized.calls.rpc.length, 0);
});
test("semantic conflict stays409 and backend transients or malformed saved receipts stay503", () => {
  for (const [code, status] of [["PT409", 409], ["42501", 403], ["22023", 400], ["40001", 503], ["40P01", 503], ["PGRST202", 503]] as const) {
    const result = route({ code }); assert.equal(result.status, status); assert.equal(result.calls.rpc.length, 1); assert.equal(JSON.stringify(result.body).includes("private diagnostic"), false);
  }
  const malformed = route({ malformedReceipt: true }); assert.equal(malformed.status, 503); assert.equal(malformed.calls.rpc.length, 1);
});

test("render scope pins reject stale accounts and business fallback before any RPC", () => {
  for (const method of ["GET", "POST"] as const) {
    for (const scenario of [{ scope: null }, { scope: "other:actual-business" }, { currentActor: "new-account" }, { currentClient: "fallback-business" }]) {
      const result = route({ method, ...scenario }); assert.equal(result.status, 403); assert.equal(result.calls.rpc.length, 0);
    }
  }
});
