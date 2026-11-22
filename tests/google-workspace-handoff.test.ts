// Actual server-action and first-owner wrapper execution with injected server
// dependencies. Cryptographic handoff verification has its own SDK tests.
// No request can reach Auth, Google, a provider, or a database from this file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const ids = { actor: "10000000-0000-4000-8000-000000000001", other: "10000000-0000-4000-8000-000000000002", client: "20000000-0000-4000-8000-000000000001", partner: "30000000-0000-4000-8000-000000000001", request: "40000000-0000-4000-8000-000000000001", attempt: "50000000-0000-4000-8000-000000000001", draft: "60000000-0000-4000-8000-000000000001", receipt: "70000000-0000-4000-8000-000000000001" };
type Scenario = {
  mode?: string; origin?: string | null; missingClient?: boolean; anonymous?: boolean; missingUser?: boolean; unverified?: boolean; authError?: boolean; authThrow?: boolean; recoverLostCreateReply?: boolean; recoverBeforeSync?: "source" | "answer";
  sessionError?: boolean; sessionMismatch?: boolean; invalidHandoff?: boolean; missingHandoff?: boolean; platformOwner?: boolean; sameActorRelogin?: boolean; unverifiedSession?: boolean; handoffMismatch?: "attemptId" | "draftId" | "requestKey" | "sessionId";
  entry?: { state: "new" | "blocked" | "setup_required"; reason?: string } | { state: "existing"; destination: "/client" | "/partner" | "/control" }; entryError?: boolean;
  portalKind?: string; portalRole?: string; portalOtherActor?: boolean; impersonating?: boolean; viewOnly?: boolean;
  form?: Record<string, string | null>; provisionFault?: "error" | "throw" | "malformed"; sourceFault?: "error" | "throw" | "malformed" | "advanced";
  saveFault?: "error" | "PT409" | "throw" | "malformed" | "wrong_key" | "wrong_revision" | "snapshot_before_receipt" | "replay_newer";
};
type Outcome = { state: { status: string; message?: string; destination?: string; clearGuest?: boolean }; calls: { client: number; auth: number; handoff: number; sessionVerification: number; portal: number; network: number; rpcs: { name: string; input?: Record<string, unknown> }[]; cookieDeletes: string[] }; recovery?: { firstState: Outcome["state"]; firstCookieDeletes: string[]; receiptKeys: string[]; changedKeyConflicts: number; description: string; knowledgeDescription: string; descriptionWrites: number; progressRevision: number } };
function submit(scenario: Scenario = {}): Outcome {
  const source = `const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},ids=${JSON.stringify(ids)};
 const calls={client:0,auth:0,handoff:0,sessionVerification:0,portal:0,network:0,rpcs:[],cookieDeletes:[]},description='Owner supplied project planning and customer coordination.',sessionId='88888888-8888-4888-8888-888888888888',otherSessionId='77777777-7777-4777-8777-777777777777';
 const recovering=scenario.recoverLostCreateReply||!!scenario.recoverBeforeSync,durable={businessCreated:false,progressRevision:0,description,knowledgeDescription:null,descriptionWrites:0},receipts=new Map();let lostCreateReply=false,failedBeforeSync=false,changedKeyConflicts=0;
 const failure={code:'SYNTHETIC_ERROR',message:'PRIVATE_DETAIL_SHOULD_NOT_ESCAPE'};
 global.fetch=async()=>{calls.network++;throw new Error('Unexpected real transport blocked')};
 const snapshot=(revision=0,step='description')=>({available:true,canEdit:true,profileRevision:(scenario.recoverLostCreateReply&&durable.knowledgeDescription?'b':'a').repeat(32),answers:{description},progress:{revision,step,skipped:[],finished:step==='done'}});
 const client={auth:{getUser:async()=>{calls.auth++;if(scenario.authThrow)throw new Error('PRIVATE_DETAIL_SHOULD_NOT_ESCAPE');return{error:scenario.authError?failure:null,data:{user:scenario.missingUser?null:{id:ids.actor,is_anonymous:!!scenario.anonymous,email_confirmed_at:scenario.unverified?null:'2026-11-22',app_metadata:scenario.platformOwner?{role:'platform_owner'}:{}}}}}},rpc:async(name,input)=>{
  calls.rpcs.push({name,input});
  if(name==='current_session_actor')return{error:scenario.sessionError?failure:null,data:scenario.sessionMismatch?ids.other:ids.actor};
  if(name==='get_first_owner_entry')return{error:scenario.entryError?failure:null,data:scenario.entry||(scenario.mode==='connect'||recovering&&durable.businessCreated?{state:'existing',destination:'/client'}:{state:'new'})};
  if(name==='provision_first_owner'){if(scenario.provisionFault==='throw')throw new Error('PRIVATE_DETAIL_SHOULD_NOT_ESCAPE');if(recovering)durable.businessCreated=true;return{error:scenario.provisionFault==='error'?failure:null,data:scenario.provisionFault==='malformed'?{clientId:ids.client}:{id:ids.receipt,partnerId:ids.partner,clientId:ids.client,destination:'/client/onboarding',replayed:false}};}
  if(name==='get_owner_onboarding'){if(scenario.recoverBeforeSync==='source'&&!failedBeforeSync){failedBeforeSync=true;return{error:failure,data:null}}if(scenario.sourceFault==='throw')throw new Error('PRIVATE_DETAIL_SHOULD_NOT_ESCAPE');return{error:scenario.sourceFault==='error'?failure:null,data:scenario.sourceFault==='malformed'?{available:true}:scenario.sourceFault==='advanced'?snapshot(3,'done'):recovering?snapshot(durable.progressRevision,durable.progressRevision?'connections':'description'):snapshot()};}
  if(name==='save_owner_onboarding'){
   if(recovering){
    if(scenario.recoverBeforeSync==='answer'&&!failedBeforeSync){failedBeforeSync=true;return{error:failure,data:null}}
    const envelope=JSON.stringify({client:input.p_client,revision:input.p_revision,command:input.p_command}),prior=receipts.get(input.p_key);
    if(prior){if(prior.envelope!==envelope){changedKeyConflicts++;return{error:{code:'PT409'},data:null}}return{error:null,data:{snapshot:snapshot(durable.progressRevision,'connections'),result:{...prior.result,replayed:true}}};}
    if(input.p_revision!==durable.progressRevision)return{error:{code:'PT409'},data:null};
    if(input.p_command.action==='answer'){durable.descriptionWrites++;durable.description=input.p_command.value;durable.knowledgeDescription=input.p_command.value;}
    durable.progressRevision++;const result={id:require('node:crypto').randomUUID(),key:input.p_key,revision:durable.progressRevision,profileRevision:snapshot().profileRevision,replayed:false,cancelledWork:0};receipts.set(input.p_key,{envelope,result});
    if(scenario.recoverLostCreateReply&&input.p_command.action==='answer'&&!lostCreateReply){lostCreateReply=true;return{error:failure,data:null}}return{error:null,data:{snapshot:snapshot(durable.progressRevision,'connections'),result}};
   }
   if(scenario.saveFault==='throw')throw new Error('PRIVATE_DETAIL_SHOULD_NOT_ESCAPE');if(scenario.saveFault==='error'||scenario.saveFault==='PT409')return{error:{...failure,code:scenario.saveFault==='PT409'?'PT409':'SYNTHETIC_ERROR'},data:null};
   if(scenario.saveFault==='malformed')return{error:null,data:{result:{key:input.p_key}}};
   const revision=input.p_revision+1;return{error:null,data:{snapshot:snapshot(scenario.saveFault==='snapshot_before_receipt'?input.p_revision:scenario.saveFault==='replay_newer'?revision+2:revision,scenario.saveFault==='replay_newer'?'done':'connections'),result:{id:ids.receipt,key:scenario.saveFault==='wrong_key'?ids.other:input.p_key,revision:scenario.saveFault==='wrong_revision'?revision+1:revision,profileRevision:'a'.repeat(32),replayed:scenario.saveFault==='replay_newer',cancelledWork:0}}};
  }
  throw new Error('Unexpected mutation or query blocked');
 }};
 const handoff={version:1,actorId:ids.actor,sessionId,attemptId:ids.attempt,draftId:ids.draft,requestKey:ids.request,issuedAt:1,expiresAt:2};
 if(scenario.handoffMismatch)handoff[scenario.handoffMismatch]=ids.other;
 const mocks={
  'next/headers':{headers:async()=>new Headers(scenario.origin===null?{}:{origin:scenario.origin||'https://workstation.synthetic.invalid'}),cookies:async()=>({get:name=>scenario.missingHandoff?undefined:{name,value:'synthetic-validated-handoff-carrier'},delete:name=>calls.cookieDeletes.push(name)})},
  '@/lib/env':{getAppUrl:()=> 'https://workstation.synthetic.invalid'},'@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;return scenario.missingClient?null:client}},
  '@/lib/auth/google-onboarding':{GOOGLE_ONBOARDING_HANDOFF_COOKIE:'synthetic_handoff',readGoogleOnboardingSessionId:async(current,actor)=>{calls.sessionVerification++;if(current!==client||actor!==ids.actor)throw new Error('Wrong verified session request');return scenario.sessionError||scenario.sessionMismatch||scenario.unverifiedSession?null:scenario.sameActorRelogin?otherSessionId:sessionId},readGoogleOnboardingHandoff:(carrier,actor,sid)=>{calls.handoff++;return carrier&&!scenario.invalidHandoff&&actor===handoff.actorId&&sid===handoff.sessionId?handoff:null}},
  '@/lib/clients/portal':{loadClientPortal:async()=>{calls.portal++;return{kind:scenario.portalKind||'ok',user:{id:scenario.portalOtherActor?ids.other:ids.actor},client:{id:ids.client,name:'Existing owner business'},access:{role:scenario.portalRole||'client_owner',isImpersonating:!!scenario.impersonating,impersonationMode:'sandbox_full',visibleClientSections:['settings','marketing','tasks','contacts','automations','action-center'],canEditClientData:!scenario.viewOnly,canOperateCustomerActions:true,canResolveApprovals:true}}}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args)};const {completeGoogleWorkspace}=require('./app/start/google-actions.ts');Module._load=original;
 const form=new FormData();Object.entries({mode:scenario.mode||'create',expectedActor:ids.actor,attemptId:ids.attempt,draftId:ids.draft,requestKey:ids.request,name:'Owner business',description,timezone:'America/Chicago',expectedClient:ids.client,revision:'5',...scenario.form}).forEach(([key,value])=>{if(value!==null)form.set(key,value)});
 (async()=>{const firstState=await completeGoogleWorkspace({status:'idle'},form);
  if(!recovering){process.stdout.write(JSON.stringify({state:firstState,calls}));return;}
  const firstCookieDeletes=[...calls.cookieDeletes];form.set('mode','connect');form.set('revision',String(durable.progressRevision));form.set('name','Do not overwrite existing business');form.set('description','Do not reapply this guest description');form.set('timezone','Not/AZone');
  const state=await completeGoogleWorkspace({status:'idle'},form);process.stdout.write(JSON.stringify({state,calls,recovery:{firstState,firstCookieDeletes,receiptKeys:[...receipts.keys()],changedKeyConflicts,...durable}}));
 })().catch(()=>{process.stderr.write('Actual handoff action escaped its failure boundary');process.exitCode=1});`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 })) as Outcome;
}
function mutations(outcome: Outcome) { return outcome.calls.rpcs.filter(call => ["provision_first_owner", "save_owner_onboarding"].includes(call.name)); }
function failed(outcome: Outcome) {
  assert.equal(outcome.state.status, "error"); assert.ok(outcome.state.message); assert.equal(outcome.state.destination, undefined); assert.equal(outcome.state.clearGuest, undefined);
  assert.deepEqual(outcome.calls.cookieDeletes, []); assert.equal(outcome.calls.network, 0); assert.doesNotMatch(outcome.state.message!, /PRIVATE_DETAIL_SHOULD_NOT_ESCAPE/);
}
test("foreign/missing origin and unknown mode cannot reach an Auth client, handoff or mutation", () => {
  for (const scenario of [{ origin: "https://foreign.synthetic.invalid" }, { origin: null }, { mode: "activate" }]) {
    const value = submit(scenario); failed(value); assert.equal(value.calls.client, 0); assert.equal(value.calls.auth, 0); assert.deepEqual(value.calls.rpcs, []); assert.equal(value.calls.handoff, 0);
  }
});
test("anonymous, missing/unverified, stale rendered actor and unavailable live session fail before any mutation or entry lookup", () => {
  for (const scenario of [{ missingClient: true }, { anonymous: true }, { missingUser: true }, { unverified: true }, { authError: true }, { authThrow: true }, { form: { expectedActor: ids.other } }, { form: { expectedActor: null } }, { sessionError: true }, { sessionMismatch: true }]) {
    const value = submit(scenario); failed(value); assert.deepEqual(mutations(value), []); assert.equal(value.calls.handoff, 0); assert.ok(!value.calls.rpcs.some(call => call.name === "get_first_owner_entry"));
  }
});
test("only the current actor's validated matching attempt/draft/request carrier can reach workspace entry", () => {
  for (const scenario of [{ invalidHandoff: true }, { missingHandoff: true }, ...(["attemptId", "draftId", "requestKey"] as const).map(handoffMismatch => ({ handoffMismatch }))]) {
    const value = submit(scenario); failed(value); assert.equal(value.calls.handoff, 1); assert.deepEqual(value.calls.rpcs.map(call => call.name), ["current_session_actor"]); assert.deepEqual(mutations(value), []);
  }
  for (const state of ["blocked", "setup_required"] as const) { const value = submit({ entry: { state, reason: "Existing eligibility gate remains closed." } }); failed(value); assert.deepEqual(mutations(value), []); }
  const unavailableEntry = submit({ entryError: true }); failed(unavailableEntry); assert.deepEqual(mutations(unavailableEntry), []); assert.equal(unavailableEntry.calls.portal, 0);
});
test("handoff session binding denies wrong SID and same-actor re-login before entry, provisioning or progress mutations", () => {
  for (const mode of ["create", "connect"] as const) for (const patch of [{ handoffMismatch: "sessionId" as const }, { sameActorRelogin: true }, { unverifiedSession: true }]) {
    const value = submit({ mode, ...patch }); failed(value); assert.equal(value.calls.sessionVerification, 1);
    assert.equal(value.calls.portal, 0); assert.deepEqual(mutations(value), []); assert.ok(!value.calls.rpcs.some(call => call.name === "get_first_owner_entry"));
  }
  const same = submit(); assert.equal(same.state.status, "complete"); assert.equal(same.calls.sessionVerification, 1);
});
test("create mode resumes an already existing destination without parsing or applying the guest answers", () => {
  for (const destination of ["/client", "/partner", "/control"] as const) {
    const value = submit({ entry: { state: "existing", destination }, form: { name: "", description: "", timezone: "Not/AZone" } });
    assert.deepEqual(value.state, { status: "complete", destination: destination === "/client" ? "/client/onboarding" : destination, clearGuest: false });
    assert.deepEqual(mutations(value), []); assert.equal(value.calls.portal, 0); assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]); assert.equal(value.calls.network, 0);
  }
});
test("an operator who also owns a client follows the server's client entry decision without a control detour or new provisioning", () => {
  // The real SQL entry function owns membership priority. This action test
  // injects its dual-role /client decision and proves no UI-side role override.
  const value = submit({ platformOwner: true, entry: { state: "existing", destination: "/client" }, form: { description: "Do not overwrite this existing business." } });
  assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: false });
  assert.deepEqual(mutations(value), []); assert.equal(value.calls.portal, 0); assert.equal(value.state.destination === "/control", false);
  assert.deepEqual(value.calls.rpcs.map(call => call.name), ["current_session_actor", "get_first_owner_entry"]);
});
test("eligible creation preserves the verified guest request key and uses only the existing atomic description/progress command", () => {
  const value = submit(); assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: true });
  assert.deepEqual(value.calls.rpcs.map(call => call.name), ["current_session_actor", "get_first_owner_entry", "provision_first_owner", "get_owner_onboarding", "save_owner_onboarding"]);
  assert.deepEqual(mutations(value).map(call => call.input), [
    { p_key: ids.request, p_business: { name: "Owner business", description: "Owner supplied project planning and customer coordination.", timezone: "America/Chicago" } },
    { p_client: ids.client, p_key: ids.attempt, p_revision: 0, p_command: { action: "answer", field: "description", value: "Owner supplied project planning and customer coordination.", expectedProfileRevision: "a".repeat(32) } },
  ]);
  assert.equal(value.calls.portal, 0); assert.equal(value.calls.network, 0); assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]);
  const invalid = submit({ form: { description: "short" } }); failed(invalid); assert.deepEqual(mutations(invalid), []);
});
test("provision/source/sync uncertainty retains the handoff and never retries or reports a completed workspace", () => {
  for (const provisionFault of ["error", "throw", "malformed"] as const) {
    const value = submit({ provisionFault }); failed(value); assert.equal(mutations(value).length, 1); assert.ok(!value.calls.rpcs.some(call => call.name === "get_owner_onboarding"));
  }
  for (const sourceFault of ["error", "throw", "malformed"] as const) { const value = submit({ sourceFault }); failed(value); assert.equal(mutations(value).length, 1); }
  for (const saveFault of ["error", "PT409", "throw", "malformed", "wrong_key", "wrong_revision"] as const) {
    const value = submit({ saveFault }); failed(value); assert.equal(mutations(value).length, 2); assert.equal(value.calls.rpcs.filter(call => call.name === "save_owner_onboarding").length, 1);
  }
});
test("a created workspace whose saved setup has already advanced resumes it without another description write", () => {
  const value = submit({ sourceFault: "advanced" });
  assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: true });
  assert.equal(mutations(value).length, 1); assert.equal(mutations(value)[0].name, "provision_first_owner"); assert.equal(value.calls.rpcs.some(call => call.name === "save_owner_onboarding"), false);
});
test("connect mode rejects ineligible destinations, role/actor/tenant changes, impersonation and malformed revisions before mutations", () => {
  for (const scenario of [
    { entry: { state: "new" as const } }, { entry: { state: "existing" as const, destination: "/partner" as const } },
    { portalKind: "unavailable" }, { portalRole: "client_manager" }, { portalRole: "client_viewer" }, { portalOtherActor: true }, { impersonating: true }, { viewOnly: true }, { form: { expectedClient: ids.other } }, { form: { expectedClient: null } },
    ...["-1", "01", "1.5", "9007199254740992", "not-a-revision"].map(revision => ({ form: { revision } })),
  ]) { const value = submit({ mode: "connect", ...scenario }); failed(value); assert.deepEqual(mutations(value), []); }
});
test("existing connect mode uses only the current scoped progress CAS and never overwrites business facts or provisions", () => {
  const value = submit({ mode: "connect", form: { name: "DO NOT APPLY", description: "Untrusted guest replacement must be ignored.", timezone: "Not/AZone" } });
  assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: false });
  assert.deepEqual(mutations(value), [{ name: "save_owner_onboarding", input: { p_client: ids.client, p_key: ids.request, p_revision: 5, p_command: { action: "navigate", step: "connections" } } }]);
  assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]); assert.equal(value.calls.network, 0);
});
test("connect conflicts and unknown receipts freeze with one attempt; exact replay accepts a newer current snapshot", () => {
  for (const saveFault of ["PT409", "error", "throw", "malformed", "wrong_key", "wrong_revision"] as const) {
    const value = submit({ mode: "connect", saveFault }); failed(value); assert.equal(mutations(value).length, 1); assert.equal(value.calls.rpcs.filter(call => call.name === "save_owner_onboarding").length, 1);
    if (saveFault === "PT409") assert.match(value.state.message!, /changed elsewhere/);
  }
  const replay = submit({ mode: "connect", saveFault: "replay_newer" }); assert.equal(replay.state.status, "complete"); assert.equal(mutations(replay).length, 1);
});
test("a snapshot older than its claimed applied receipt fails closed in both create and connect modes", () => {
  for (const mode of ["create", "connect"] as const) { const value = submit({ mode, saveFault: "snapshot_before_receipt" }); failed(value); }
});
test("lost create-answer reply resumes as an existing owner with a distinct navigation receipt key and no fact overwrite or second provision", () => {
  // The two actual action invocations share a durable receipt fixture. Reusing
  // the create-answer key for navigation returns PT409, as the real SQL does.
  const value = submit({ recoverLostCreateReply: true }), recovery = value.recovery!;
  assert.equal(recovery.firstState.status, "error"); assert.match(recovery.firstState.message!, /could not be confirmed/); assert.equal(recovery.firstState.clearGuest, undefined); assert.deepEqual(recovery.firstCookieDeletes, []);
  assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: false });
  assert.deepEqual(recovery.receiptKeys, [ids.attempt, ids.request]); assert.equal(recovery.changedKeyConflicts, 0);
  assert.equal(value.calls.rpcs.filter(call => call.name === "provision_first_owner").length, 1);
  assert.deepEqual(value.calls.rpcs.filter(call => call.name === "save_owner_onboarding").map(call => ({ key: call.input!.p_key, revision: call.input!.p_revision, command: call.input!.p_command })), [
    { key: ids.attempt, revision: 0, command: { action: "answer", field: "description", value: "Owner supplied project planning and customer coordination.", expectedProfileRevision: "a".repeat(32) } },
    { key: ids.request, revision: 1, command: { action: "navigate", step: "connections" } },
  ]);
  assert.equal(recovery.description, "Owner supplied project planning and customer coordination."); assert.equal(recovery.knowledgeDescription, recovery.description); assert.equal(recovery.descriptionWrites, 1); assert.equal(recovery.progressRevision, 2);
  assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]); assert.equal(value.calls.network, 0);
});

test("creation committed before initial source or answer persistence resumes the saved description without skipping synchronization", () => {
  for (const recoverBeforeSync of ["source", "answer"] as const) {
    const value = submit({ recoverBeforeSync }), recovery = value.recovery!;
    assert.equal(recovery.firstState.status, "error"); assert.match(recovery.firstState.message!, /could not be confirmed/);
    assert.deepEqual(recovery.firstCookieDeletes, []);
    assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: false });
    assert.equal(value.calls.rpcs.filter(call => call.name === "provision_first_owner").length, 1);
    assert.equal(value.calls.rpcs.filter(call => call.name === "save_owner_onboarding").length, recoverBeforeSync === "answer" ? 1 : 0);
    assert.equal(value.calls.rpcs.some(call => call.input?.p_command && (call.input.p_command as {action?:string}).action === "navigate"), false);
    assert.equal(recovery.progressRevision, 0); assert.deepEqual(recovery.receiptKeys, []); assert.equal(recovery.changedKeyConflicts, 0);
    assert.equal(recovery.description, "Owner supplied project planning and customer coordination.");
    assert.equal(recovery.knowledgeDescription, null); assert.equal(recovery.descriptionWrites, 0);
    assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]); assert.equal(value.calls.network, 0);
  }
});

test("an existing owner with untouched setup opens its saved description without applying anonymous answers or advancing progress", () => {
  const value = submit({ mode: "connect", form: { revision: "0", description: "Never overwrite the saved business from a guest draft." } });
  assert.deepEqual(value.state, { status: "complete", destination: "/client/onboarding", clearGuest: false });
  assert.deepEqual(mutations(value), []); assert.deepEqual(value.calls.cookieDeletes, ["synthetic_handoff"]);
});
