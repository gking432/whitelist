import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = {
  authenticated?: boolean; configured?: boolean; ready?: boolean; missingClient?: boolean; entryFailure?: boolean; forbidReadiness?: boolean; authFailure?: boolean;
  entry?: { state: "new" } | { state: "existing"; destination: "/client" | "/partner" | "/control" } | { state: "blocked" | "setup_required"; reason: string };
  query?: { google?: string; restart?: string }; handoff?: "valid" | "invalid" | "expired" | "other_actor" | "other_session"; platformOwner?: boolean; sameActorRelogin?: boolean; unverifiedSession?: boolean;
  portalKind?: string; portalRole?: string; portalActorMismatch?: boolean; portalClient?: string; impersonating?: boolean; viewOnly?: boolean;
  progressError?: boolean; progressMalformed?: boolean; progressRevision?: number;
};
const actorId = "11111111-1111-4111-8111-111111111111", clientId = "22222222-2222-4222-8222-222222222222", otherId = "33333333-3333-4333-8333-333333333333";
function startPage(scenario: Scenario) {
  const program = `
 const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},calls={auth:0,userClient:0,entry:0,adminClient:0,readiness:0};
 const actorId=${JSON.stringify(actorId)},clientId=${JSON.stringify(clientId)},otherId=${JSON.stringify(otherId)},sessionId='88888888-8888-4888-8888-888888888888',otherSessionId='77777777-7777-4777-8777-777777777777',googleCalls={cookie:0,handoff:0,sessionVerification:0,portal:0,rpcs:[],network:0};
 process.env.SECRETS_ENCRYPTION_KEY=Buffer.alloc(32,17).toString('base64');
 const google=require('./lib/auth/google-onboarding.ts'),{encryptSecret}=require('./lib/integrations/secrets.ts');
 const now=Date.now(),issuedAt=now-(scenario.handoff==='expired'?600001:1000),handoffValue={version:1,actorId:scenario.handoff==='other_actor'?otherId:actorId,sessionId:scenario.handoff==='other_session'?otherSessionId:sessionId,attemptId:'44444444-4444-4444-8444-444444444444',draftId:'55555555-5555-4555-8555-555555555555',requestKey:'66666666-6666-4666-8666-666666666666',issuedAt,expiresAt:issuedAt+600000};
 const carrier=!scenario.handoff?undefined:scenario.handoff==='invalid'?'invalid-private-carrier-must-not-render':encryptSecret(JSON.stringify(handoffValue));
 global.fetch=async()=>{googleCalls.network++;throw new Error('Unexpected real network blocked')};
 const userClient={kind:'authenticated-user-client',rpc:async(name,input)=>{googleCalls.rpcs.push({name,input});if(name!=='get_owner_onboarding')throw new Error('Unexpected mutation blocked');return{error:scenario.progressError?{code:'SYNTHETIC_UNAVAILABLE',message:'private-backend-text-must-not-render'}:null,data:scenario.progressMalformed?{available:true}:{available:true,canEdit:true,profileRevision:'a'.repeat(32),answers:{description:'private-business-answers-must-not-render'},progress:{revision:scenario.progressRevision??7,step:'done',skipped:[],finished:true}}}}},adminClient={kind:'server-admin-client'};
 const jsx=(type,props)=>({type,props:props||{}});
 const mocks={
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'next/link':{__esModule:true,default:'Link'},
  'next/navigation':{redirect:destination=>{throw Object.assign(new Error('Synthetic Next redirect'),{destination});}},
  'next/headers':{cookies:async()=>{googleCalls.cookie++;return{get:name=>carrier&&name===google.GOOGLE_ONBOARDING_HANDOFF_COOKIE?{name,value:carrier}:undefined}}},
  '@/lib/auth/session':{getAuthState:async()=>{calls.auth++;if(scenario.authFailure)throw Error('Synthetic Auth unavailable');return{user:scenario.authenticated?{id:actorId,app_metadata:scenario.platformOwner?{role:'platform_owner'}:{}}:null,isSupabaseConfigured:scenario.configured!==false};}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.userClient++;return scenario.missingClient?null:userClient;}},
  '@/lib/auth/first-owner':{loadFirstOwnerEntry:async client=>{calls.entry++;if(client!==userClient)throw new Error('Wrong entry client');if(scenario.entryFailure)throw new Error('Synthetic entry lookup failed');return scenario.entry||{state:'new'};}},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{calls.adminClient++;return adminClient;}},
  '@/lib/auth/owner-setup-readiness':{readOwnerSetupReadiness:async client=>{calls.readiness++;if(scenario.forbidReadiness)throw new Error('Existing workspace must not query the new-owner gate');if(client!==adminClient)throw new Error('Wrong readiness client');return{available:!!scenario.ready,message:'Synthetic safe setup unavailable.'};}},
  './first-owner-form':{FirstOwnerForm:'FirstOwnerForm'},
  '@/components/onboarding/guest-owner-form':{GuestOwnerForm:'GuestOwnerForm'},
  '@/lib/auth/google-onboarding':{isGoogleOnboardingConfigured:()=>false,readGoogleOnboardingSessionId:async(client,actor)=>{googleCalls.sessionVerification++;if(client!==userClient||actor!==actorId)throw new Error('Wrong verified session request');return scenario.unverifiedSession?null:scenario.sameActorRelogin?otherSessionId:sessionId},readGoogleOnboardingHandoff:(value,actor,sid)=>{googleCalls.handoff++;return google.readGoogleOnboardingHandoff(value,actor,sid)},GOOGLE_ONBOARDING_HANDOFF_COOKIE:google.GOOGLE_ONBOARDING_HANDOFF_COOKIE},
  '@/lib/clients/portal':{loadClientPortal:async()=>{googleCalls.portal++;return{kind:scenario.portalKind||'ok',user:{id:scenario.portalActorMismatch?otherId:actorId},client:{id:scenario.portalClient||clientId,name:'Existing verified client'},access:{role:scenario.portalRole||'client_owner',isImpersonating:!!scenario.impersonating,impersonationMode:'sandbox_full',visibleClientSections:['settings','marketing','tasks','contacts','automations','action-center'],canEditClientData:!scenario.viewOnly,canOperateCustomerActions:true,canResolveApprovals:true}}}},
  './google-handoff':{GoogleWorkspaceHandoff:'GoogleWorkspaceHandoff'},
  '@/components/auth/sign-out-button':{SignOutButton:'SignOutButton'},
  '@/components/auth/setup-unavailable':{SetupUnavailable:'SetupUnavailable'},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
 const Page=require('./app/start/page.tsx').default;Module._load=original;
 const collect=tree=>{
  const forms=[],guests=[],handoffs=[],headings=[],statuses=[],gates=[];
  const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
  const walk=node=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;
   if(node.type==='GuestOwnerForm')guests.push({googleAvailable:node.props.googleAvailable});
   if(node.type==='FirstOwnerForm')forms.push({requestKey:node.props.requestKey,draftScopeKey:node.props.draftScopeKey});
   if(node.type==='GoogleWorkspaceHandoff')handoffs.push(node.props);
   if(node.type==='h1')headings.push(text(node));
   if(node.props?.role==='status')statuses.push(text(node));
   if(node.type==='SetupUnavailable')gates.push(node.props.message);
   walk(node.props?.children);
  };walk(tree);return{forms,guests,handoffs,headings,statuses,gates};
 };
 Promise.resolve().then(()=>Page({searchParams:Promise.resolve(scenario.query||{})})).then(tree=>process.stdout.write(JSON.stringify({redirect:null,...collect(tree),calls,googleCalls}))).catch(error=>{
  if(typeof error.destination==='string')process.stdout.write(JSON.stringify({redirect:error.destination,forms:[],guests:[],handoffs:[],headings:[],statuses:[],gates:[],calls,googleCalls}));
  else{process.stderr.write('Page failed instead of returning a gate or deliberate redirect');process.exitCode=1;}
 });
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    redirect: string | null; forms: { requestKey: string; draftScopeKey: string }[]; guests: {googleAvailable:boolean}[]; headings: string[]; statuses: string[]; gates: string[];
    handoffs: { mode: string; actorId: string; attemptId: string; draftId: string; requestKey: string; clientId?: string; businessName?: string; revision?: number; startAtDescription?: boolean }[];
    calls: { auth: number; userClient: number; entry: number; adminClient: number; readiness: number };
    googleCalls: { cookie: number; handoff: number; sessionVerification: number; portal: number; network: number; rpcs: { name: string; input: Record<string, unknown> }[] };
  };
}

test("authenticated new owner cannot create a business while the data prerequisite is unavailable", () => {
  const result = startPage({ authenticated: true, ready: false, entry: { state: "new" } });
  assert.equal(result.redirect, null); assert.equal(result.forms.length, 0);
  assert.deepEqual(result.headings, ["Business setup unavailable"]);
  assert.deepEqual(result.statuses, ["Synthetic safe setup unavailable."]);
  assert.deepEqual(result.calls, { auth: 1, userClient: 1, entry: 1, adminClient: 1, readiness: 1 });
});

test("authenticated eligible new owner sees exactly one real create form after the readiness check", () => {
  const result = startPage({ authenticated: true, ready: true, entry: { state: "new" } });
  assert.equal(result.redirect, null); assert.equal(result.forms.length, 1);
  assert.match(result.forms[0].requestKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(result.forms[0].draftScopeKey, actorId);
  assert.deepEqual(result.headings, []); // The shared question screen owns the sole heading.
  assert.equal(result.calls.entry, 1); assert.equal(result.calls.readiness, 1);
});

test("existing business and operator destinations preserve their prior verified entry without a readiness query", () => {
  for (const destination of ["/client", "/partner", "/control"] as const) {
    const result = startPage({ authenticated: true, ready: false, forbidReadiness: true, entry: { state: "existing", destination } });
    assert.equal(result.redirect, destination); assert.equal(result.forms.length, 0);
    assert.deepEqual(result.calls, { auth: 1, userClient: 1, entry: 1, adminClient: 0, readiness: 0 });
  }
});

test("anonymous questions require neither Auth configuration nor setup readiness or private data", () => {
  for (const scenario of [{ready:true}, {ready:false}, {configured:false}, {authFailure:true}]) {
    const result = startPage({...scenario,forbidReadiness:true});
    assert.equal(result.redirect,null); assert.equal(result.forms.length,0);
    assert.deepEqual(result.guests,[{googleAvailable:false}]); assert.deepEqual(result.gates,[]);
    assert.deepEqual(result.calls,{auth:1,userClient:0,entry:0,adminClient:0,readiness:0});
  }
});

test("blocked, unconfigured operator and failed entry decisions never expose the create form", () => {
  for (const scenario of [
    { entry: { state: "blocked", reason: "This account already has workspace history." } },
    { entry: { state: "setup_required", reason: "Operator setup is required." } },
    { entryFailure: true }, { missingClient: true },
  ] as const) {
    const result = startPage({ authenticated: true, ready: true, forbidReadiness: true, ...scenario });
    assert.equal(result.redirect, null); assert.equal(result.forms.length, 0); assert.deepEqual(result.headings, ["Business setup unavailable"]);
    assert.equal(result.calls.adminClient, 0); assert.equal(result.calls.readiness, 0);
  }
});

test("a valid Google return for an eligible new owner renders the verified create handoff only after readiness", () => {
  const result = startPage({ authenticated: true, ready: true, query: { google: "return" }, handoff: "valid", entry: { state: "new" } });
  assert.equal(result.redirect, null); assert.deepEqual(result.forms, []); assert.deepEqual(result.guests, []);
  assert.deepEqual(result.handoffs, [{ mode: "create", actorId, attemptId: "44444444-4444-4444-8444-444444444444", draftId: "55555555-5555-4555-8555-555555555555", requestKey: "66666666-6666-4666-8666-666666666666" }]);
  assert.equal(result.calls.readiness, 1); assert.equal(result.googleCalls.sessionVerification, 1); assert.equal(result.googleCalls.handoff, 1); assert.equal(result.googleCalls.portal, 0); assert.deepEqual(result.googleCalls.rpcs, []); assert.equal(result.googleCalls.network, 0);
  const notReady = startPage({ authenticated: true, ready: false, query: { google: "return" }, handoff: "valid", entry: { state: "new" } });
  assert.deepEqual(notReady.handoffs, []); assert.deepEqual(notReady.forms, []); assert.deepEqual(notReady.headings, ["Business setup unavailable"]);
});
test("existing owner Google return uses the fresh portal client and saved progress, including an operator who also owns a client", () => {
  for (const platformOwner of [false, true]) {
    const result = startPage({ authenticated: true, forbidReadiness: true, platformOwner, query: { google: "return" }, handoff: "valid", entry: { state: "existing", destination: "/client" }, portalClient: otherId, progressRevision: 19 });
    assert.equal(result.redirect, null); assert.deepEqual(result.forms, []); assert.equal(result.handoffs.length, 1);
    assert.deepEqual(result.handoffs[0], { mode: "connect", actorId, attemptId: "44444444-4444-4444-8444-444444444444", draftId: "55555555-5555-4555-8555-555555555555", requestKey: "66666666-6666-4666-8666-666666666666", clientId: otherId, businessName: "Existing verified client", revision: 19 });
    assert.deepEqual(result.googleCalls.rpcs, [{ name: "get_owner_onboarding", input: { p_client: otherId } }]); assert.equal(result.calls.readiness, 0); assert.equal(result.googleCalls.network, 0);
    assert.equal(result.googleCalls.sessionVerification, 1);
    assert.doesNotMatch(JSON.stringify(result.handoffs), /private-business-answers-must-not-render|carrier|issuedAt|expiresAt|sessionId/);
  }
});
test("an existing workspace with untouched saved setup prompts for its saved description before apps", () => {
  const result = startPage({ authenticated: true, forbidReadiness: true, query: { google: "return" }, handoff: "valid", entry: { state: "existing", destination: "/client" }, progressRevision: 0 });
  assert.equal(result.redirect, null); assert.equal(result.handoffs.length, 1);
  assert.equal(result.handoffs[0].mode, "connect"); assert.equal(result.handoffs[0].startAtDescription, true); assert.equal(result.handoffs[0].revision, 0);
  assert.deepEqual(result.googleCalls.rpcs, [{ name: "get_owner_onboarding", input: { p_client: clientId } }]);
  assert.equal(result.calls.readiness, 0); assert.equal(result.googleCalls.network, 0);
});
test("invalid, expired and actor-mismatched actual encrypted handoffs preserve existing redirects without reading private setup", () => {
  for (const handoff of ["invalid", "expired", "other_actor"] as const) {
    const result = startPage({ authenticated: true, forbidReadiness: true, query: { google: "return" }, handoff, entry: { state: "existing", destination: "/client" } });
    assert.equal(result.redirect, "/client"); assert.deepEqual(result.handoffs, []); assert.deepEqual(result.forms, []); assert.equal(result.googleCalls.portal, 0); assert.deepEqual(result.googleCalls.rpcs, []);
    assert.doesNotMatch(JSON.stringify(result), /invalid-private-carrier|private-business-answers|private-backend-text/);
  }
});
test("restart and non-return navigation bypass the carrier while preserving eligible creation and existing resume", () => {
  for (const query of [{ google: "return", restart: "1" }, { google: "failed" }, {}]) {
    const result = startPage({ authenticated: true, ready: true, query, handoff: "valid", entry: { state: "new" } });
    assert.equal(result.forms.length, 1); assert.deepEqual(result.handoffs, []); assert.equal(result.googleCalls.cookie, 0); assert.equal(result.googleCalls.handoff, 0); assert.equal(result.googleCalls.sessionVerification, 0); assert.equal(result.calls.readiness, 1);
  }
  const existing = startPage({ authenticated: true, query: { google: "return", restart: "1" }, handoff: "valid", entry: { state: "existing", destination: "/client" }, forbidReadiness: true });
  assert.equal(existing.redirect, "/client"); assert.deepEqual(existing.handoffs, []); assert.equal(existing.googleCalls.cookie, 0);
});
test("a wrong-SID handoff or same-actor fresh sign-in cannot load the previous session's existing-business handoff", () => {
  for (const patch of [{ handoff: "other_session" as const }, { sameActorRelogin: true }, { unverifiedSession: true }]) {
    const result = startPage({ authenticated: true, query: { google: "return" }, handoff: "valid", entry: { state: "existing", destination: "/client" }, forbidReadiness: true, ...patch });
    assert.equal(result.redirect, "/client"); assert.deepEqual(result.handoffs, []); assert.deepEqual(result.forms, []);
    assert.equal(result.googleCalls.sessionVerification, 1); assert.equal(result.googleCalls.portal, 0); assert.deepEqual(result.googleCalls.rpcs, []); assert.equal(result.googleCalls.network, 0);
  }
  const newOwner = startPage({ authenticated: true, ready: true, query: { google: "return" }, handoff: "valid", sameActorRelogin: true, entry: { state: "new" } });
  assert.deepEqual(newOwner.handoffs, []); assert.equal(newOwner.forms.length, 1); assert.equal(newOwner.forms[0].draftScopeKey, actorId);
});
test("a valid handoff cannot override blocked/setup-required entry or unauthorized/stale existing portal access", () => {
  for (const state of ["blocked", "setup_required"] as const) {
    const result = startPage({ authenticated: true, ready: true, forbidReadiness: true, query: { google: "return" }, handoff: "valid", entry: { state, reason: "Existing access remains blocked." } });
    assert.equal(result.redirect, null); assert.deepEqual(result.handoffs, []); assert.deepEqual(result.forms, []); assert.deepEqual(result.headings, ["Business setup unavailable"]); assert.equal(result.googleCalls.portal, 0); assert.deepEqual(result.googleCalls.rpcs, []); assert.equal(result.calls.readiness, 0);
  }
  for (const patch of [{ portalKind: "unavailable" }, { portalRole: "client_manager" }, { portalActorMismatch: true }, { impersonating: true }, { viewOnly: true }, { progressError: true }, { progressMalformed: true }]) {
    const result = startPage({ authenticated: true, query: { google: "return" }, handoff: "valid", entry: { state: "existing", destination: "/client" }, forbidReadiness: true, ...patch });
    assert.equal(result.redirect, "/client"); assert.deepEqual(result.handoffs, []); assert.deepEqual(result.forms, []);
    assert.ok(result.googleCalls.rpcs.every(call => call.name === "get_owner_onboarding")); assert.equal(result.googleCalls.network, 0);
  }
});
