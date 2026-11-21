import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { EMPTY_PROFILE, parseBusinessProfileSaveReceipt } from "../lib/business/types.ts";

const actor = "11111111-1111-4111-8111-111111111111", client = "22222222-2222-4222-8222-222222222222", partner = "33333333-3333-4333-8333-333333333333", key = "44444444-4444-4444-8444-444444444444", revision = "opaque-combined-profile-and-knowledge";
const profile = { ...EMPTY_PROFILE, description: "Actual supplied business facts.", services: "Existing service", hours: "Existing hours", policies: "Existing policy" };
const receipt = { id: actor, key, revision: "applied-combined-revision", replayed: false, cancelledWork: 0 };
function run<T>(program: string): T { return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 })) as T; }

test("full profile writes require exact request/version and preserve server owner, full-manager and sandbox authorization before one atomic RPC", () => {
  const result = run<{ success: { calls: { name: string; args: Record<string, unknown> }[]; ok: boolean }[]; denied: { status: number; calls: number }[]; invalid: { status: number; calls: number }[] }>(`
   const Module=require('node:module'),original=Module._load;
   Module._load=function(name,...args){if(name==='./engine')return {};return original.call(this,name,...args);};
   const {mutateBusinessWorkspace}=require('./lib/business/mutations.ts');Module._load=original;
   const {buildAccessContext}=require('./lib/permissions/roles.ts');
   const owner=buildAccessContext({userId:${JSON.stringify(actor)},role:'client_owner',clientId:${JSON.stringify(client)},partnerId:${JSON.stringify(partner)},clientPortalEnabled:true});
   const manager=buildAccessContext({userId:${JSON.stringify(actor)},role:'client_manager',clientId:${JSON.stringify(client)},partnerId:${JSON.stringify(partner)},clientPortalEnabled:true});
   const command={action:'save_profile',requestKey:${JSON.stringify(key)},expectedRevision:${JSON.stringify(revision)},profile:${JSON.stringify(profile)}};
   async function attempt(access,input=command){const calls=[];const admin={from(){throw Error('Direct table write is forbidden');},rpc:async(name,args)=>{calls.push({name,args});return {data:${JSON.stringify(receipt)},error:null};}};try{const saved=await mutateBusinessWorkspace(admin,{user:{id:${JSON.stringify(actor)}},client:{id:${JSON.stringify(client)},partner_id:${JSON.stringify(partner)}},access},input);return{ok:saved.ok,calls};}catch(e){return{status:e.status,calls:calls.length};}}
   (async()=>{const success=[];for(const access of[owner,manager,{...owner,isImpersonating:true,impersonationMode:'sandbox_full'}])success.push(await attempt(access));
   const denied=[];for(const access of[{...owner,role:'client_staff'},{...owner,role:'client_viewer'},{...owner,canEditClientData:false},{...owner,isImpersonating:true,impersonationMode:'read_only'}])denied.push(await attempt(access));
   const invalid=[];for(const input of[{...command,requestKey:undefined},{...command,expectedRevision:undefined},{...command,requestKey:'not-uuid'},{...command,actorId:${JSON.stringify(actor)}},{...command,clientId:${JSON.stringify(client)}},{...command,profile:{description:'Partial defaults must not erase facts'}},{...command,profile:{...command.profile,future:'hidden override'}}])invalid.push(await attempt(owner,input));
   process.stdout.write(JSON.stringify({success,denied,invalid}));})().catch(e=>{process.stderr.write(e.message);process.exitCode=1;});
  `);
  assert.equal(result.success.length, 3);
  for (const saved of result.success) { assert.equal(saved.ok, true); assert.deepEqual(saved.calls, [{ name: "save_business_profile", args: { p_partner: partner, p_client: client, p_actor: actor, p_key: key, p_revision: revision, p_profile: profile } }]); }
  for (const denied of result.denied) assert.deepEqual(denied, { status: 403, calls: 0 });
  for (const invalid of result.invalid) assert.deepEqual(invalid, { status: 422, calls: 0 });
});

test("actual mutation maps only semanticPT409 to conflict, keeps genuine backend failures503, and never repeats an uncertain RPC", () => {
  const result = run<{ code: string; status: number; calls: number; message: string }[]>(`
   const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){return name==='./engine'?{}:original.call(this,name,...args);};const{mutateBusinessWorkspace}=require('./lib/business/mutations.ts');Module._load=original;
   const{buildAccessContext}=require('./lib/permissions/roles.ts');const access=buildAccessContext({userId:${JSON.stringify(actor)},role:'client_owner',clientId:${JSON.stringify(client)},partnerId:${JSON.stringify(partner)},clientPortalEnabled:true});
   (async()=>{const out=[];for(const code of['PT409','42501','22023','40001','40P01','PGRST003','XX000','throw','partial']){let calls=0;const admin={rpc:async()=>{calls++;if(code==='throw')throw Error('private credential');return code==='partial'?{data:{id:'partial'},error:null}:{error:{code,message:'private credential changed'}};}};try{await mutateBusinessWorkspace(admin,{access,user:{id:${JSON.stringify(actor)}},client:{id:${JSON.stringify(client)},partner_id:${JSON.stringify(partner)}}},{action:'save_profile',requestKey:${JSON.stringify(key)},expectedRevision:${JSON.stringify(revision)},profile:${JSON.stringify(profile)}});}catch(e){out.push({code,status:e.status,calls,message:e.message});}}process.stdout.write(JSON.stringify(out));})();
  `);
  assert.equal(result.length, 9);
  for (const row of result) { assert.equal(row.status, row.code === "PT409" ? 409 : row.code === "42501" ? 403 : row.code === "22023" ? 422 : 503); assert.equal(row.calls, 1); assert.doesNotMatch(row.message, /private|credential|XX000|PGRST/); }
});

test("loaded detailed settings use the exact scoped combined getter and never fabricate an editable version on failure", () => {
  const result = run<{ good: { profileRevision: string; profile: typeof profile; error: null }; bad: { profileRevision: null; error: string }; malformed: { profileRevision: null; error: string }; calls: unknown[] }>(`
   const Module=require('node:module'),original=Module._load;Module._load=function(name,...args){if(name==='@/lib/supabase/admin')return {};if(name==='@/lib/ai/provider')return {isAIConfigured:()=>false};return original.call(this,name,...args);};const{readBusinessData}=require('./lib/business/data.ts');Module._load=original;
   const calls=[];function admin(mode){return{rpc:async(name,args)=>{calls.push({name,args});return mode==='bad'?{error:{code:'40001'},data:null}:{error:null,data:mode==='malformed'?{profile:{}}:{profile:{...${JSON.stringify(profile)},future_fact:{keep:true}},revision:${JSON.stringify(revision)}}};},from(){const q={select(){return q;},eq(){return q;},order(){return q;},limit(){return q;},then(resolve){return Promise.resolve(resolve({data:[],error:null,count:0}));}};return q;}};}
   (async()=>{process.stdout.write(JSON.stringify({good:await readBusinessData(admin('good'),${JSON.stringify(partner)},${JSON.stringify(client)}),bad:await readBusinessData(admin('bad'),${JSON.stringify(partner)},${JSON.stringify(client)}),malformed:await readBusinessData(admin('malformed'),${JSON.stringify(partner)},${JSON.stringify(client)}),calls}));})();
  `);
  assert.equal(result.good.profileRevision, revision); assert.deepEqual(result.good.profile, profile); assert.equal(result.good.error, null);
  for (const row of [result.bad, result.malformed]) { assert.equal(row.profileRevision, null); assert.ok(row.error); }
  assert.deepEqual(result.calls, Array.from({ length: 3 }, () => ({ name: "get_business_profile_snapshot", args: { p_partner: partner, p_client: client } })));
});

test("profile HTTP outcomes preserve exact retry body, require a complete scoped receipt, and keep stale or unknown results unsaved", () => {
  const result = run<{ kinds: string[]; bodies: unknown[]; complete: boolean; foreign: boolean }>(`
   const Module=require('node:module'),original=Module._load;const mocks={'./setup':{},'./capabilities':{},'./record-fields':{},'./record-editor':{},'./record-detail':{}};Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};const{requestBusinessProfileSave,readProfileWorkspaceSnapshot}=require('./components/business/workspace.tsx');Module._load=original;
   const scope=${JSON.stringify(`${actor}:${client}`)},command={action:'save_profile',requestKey:${JSON.stringify(key)},expectedRevision:${JSON.stringify(revision)},profile:${JSON.stringify(profile)}};
   const snapshot={clientId:${JSON.stringify(client)},clientName:'Synthetic business',workspaceScopeKey:scope,profile:${JSON.stringify(profile)},profileRevision:'applied-combined-revision',records:[],installs:[],events:[],contacts:[],connections:[],pendingCustomerApprovals:0,aiConfigured:false,canWrite:true,isTestAccount:false,setupRequired:false,error:null};
   (async()=>{const bodies=[],kinds=[];for(const status of[200,409,503]){const outcome=await requestBusinessProfileSave(command,scope,snapshot.clientId,async(_url,options)=>{bodies.push(JSON.parse(options.body));if(options.headers['X-Workstation-Scope']!==scope)throw Error('scope');return new Response(JSON.stringify(status===200?{ok:true,profileReceipt:${JSON.stringify(receipt)},snapshot}:{error:'private token'}),{status});});kinds.push(outcome.kind);}
   kinds.push((await requestBusinessProfileSave(command,scope,snapshot.clientId,async(_url,options)=>{bodies.push(JSON.parse(options.body));throw Error('private transport');})).kind);
   kinds.push((await requestBusinessProfileSave(command,scope,snapshot.clientId,async()=>new Response(JSON.stringify({ok:true,snapshot,profileReceipt:{id:'partial'}})))).kind);
   process.stdout.write(JSON.stringify({kinds,bodies,complete:!!readProfileWorkspaceSnapshot(snapshot,scope,snapshot.clientId),foreign:!!readProfileWorkspaceSnapshot({...snapshot,workspaceScopeKey:'foreign'},scope,snapshot.clientId)}));})();
  `);
  assert.deepEqual(result.kinds, ["saved", "stale", "uncertain", "uncertain", "uncertain"]); assert.equal(result.complete, true); assert.equal(result.foreign, false);
  assert.equal(result.bodies.length, 4); for (const body of result.bodies) assert.deepEqual(body, { action: "save_profile", requestKey: key, expectedRevision: revision, profile });
});

test("only exact durable profile receipt fields are accepted", () => {
  assert.deepEqual(parseBusinessProfileSaveReceipt(receipt, key), receipt);
  for (const value of [{ ...receipt, key: actor }, { ...receipt, cancelledWork: -1 }, { ...receipt, replayed: "true" }, { ...receipt, revision: "" }, { ...receipt, raw: "private" }, { id: actor }]) assert.equal(parseBusinessProfileSaveReceipt(value, key), null);
});

test("workspace API uses exact current scope and semantic profile statuses while leaving other-command mapping intact", () => {
  const result = run<{ name: string; status: number; calls: number; body: { error?: string } }[]>(`
   const Module=require('node:module'),original=Module._load;let current={},calls=0;
   const{buildAccessContext}=require('./lib/permissions/roles.ts');const portal={kind:'ok',access:buildAccessContext({userId:${JSON.stringify(actor)},role:'client_owner',clientId:${JSON.stringify(client)},partnerId:${JSON.stringify(partner)},clientPortalEnabled:true}),user:{id:${JSON.stringify(actor)}},client:{id:${JSON.stringify(client)},partner_id:${JSON.stringify(partner)}}};
   const mocks={'@/lib/env':{getAppUrl:()=> 'http://127.0.0.1:3000'},'@/lib/auth/session':{getAuthState:async()=>({user:{id:${JSON.stringify(actor)}}})},'@/lib/clients/portal':{loadClientPortal:async()=>portal},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>({rpc:async()=>{calls++;return current.code?{error:{code:current.code,message:'private backend diagnostic'}}:{data:${JSON.stringify(receipt)},error:null};}})},'@/lib/business/data':{loadBusinessSnapshot:async()=>{if(current.reloadFails)throw Error('private postcommit reload');return {profileRevision:${JSON.stringify(revision)}};}},'./engine':{}};
   Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};const handler=require('./app/api/business/workspace/route.ts');Module._load=original;const{NextRequest}=require('next/server');
   const command={action:'save_profile',requestKey:${JSON.stringify(key)},expectedRevision:${JSON.stringify(revision)},profile:${JSON.stringify(profile)}};
   (async()=>{const out=[];for(const scenario of[{name:'success'},{name:'PT409',code:'PT409'},{name:'permission',code:'42501'},{name:'input',code:'22023'},{name:'serialization',code:'40001'},{name:'deadlock',code:'40P01'},{name:'unknown',code:'XX000'},{name:'lostreload',reloadFails:true},{name:'missingtoken',body:{...command,expectedRevision:undefined}},{name:'missingkey',body:{...command,requestKey:undefined}},{name:'missingscope',scope:null},{name:'foreignscope',scope:'foreign:business'},{name:'legacyother',code:'XX000',scope:null,body:{action:'transition',id:${JSON.stringify(key)},revision:1,transition:'start'}}]){current=scenario;calls=0;const request=new NextRequest('http://127.0.0.1:3000/api/business/workspace?clientId=foreign&actorId=other',{method:'POST',headers:{origin:'http://127.0.0.1:3000',...(scenario.scope===null?{}:{'X-Workstation-Scope':scenario.scope||${JSON.stringify(`${actor}:${client}`)}})},body:JSON.stringify(scenario.body||command)});const response=await handler.POST(request);out.push({name:scenario.name,status:response.status,calls,body:await response.json()});}process.stdout.write(JSON.stringify(out));})();
  `);
  const expected: Record<string, [number, number]> = { success: [200, 1], PT409: [409, 1], permission: [403, 1], input: [422, 1], serialization: [503, 1], deadlock: [503, 1], unknown: [503, 1], lostreload: [503, 1], missingtoken: [422, 0], missingkey: [422, 0], missingscope: [403, 0], foreignscope: [403, 0], legacyother: [400, 1] };
  assert.equal(result.length, Object.keys(expected).length);
  for (const row of result) { assert.deepEqual([row.status, row.calls], expected[row.name]); assert.doesNotMatch(JSON.stringify(row.body), /private backend|private postcommit|XX000|40001|40P01/); }
});
