import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = {
  authenticated?: boolean; configured?: boolean; ready?: boolean; missingClient?: boolean; entryFailure?: boolean; forbidReadiness?: boolean;
  entry?: { state: "new" } | { state: "existing"; destination: "/client" | "/partner" | "/control" } | { state: "blocked" | "setup_required"; reason: string };
};
function startPage(scenario: Scenario) {
  const program = `
 const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},calls={auth:0,userClient:0,entry:0,adminClient:0,readiness:0};
 const userClient={kind:'authenticated-user-client'},adminClient={kind:'server-admin-client'};
 const jsx=(type,props)=>({type,props:props||{}});
 const mocks={
  'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'Fragment'},
  'next/link':{__esModule:true,default:'Link'},
  'next/navigation':{redirect:destination=>{throw Object.assign(new Error('Synthetic Next redirect'),{destination});}},
  '@/lib/auth/session':{getAuthState:async()=>{calls.auth++;return{user:scenario.authenticated?{id:'synthetic-authenticated-owner'}:null,isSupabaseConfigured:scenario.configured!==false};}},
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.userClient++;return scenario.missingClient?null:userClient;}},
  '@/lib/auth/first-owner':{loadFirstOwnerEntry:async client=>{calls.entry++;if(client!==userClient)throw new Error('Wrong entry client');if(scenario.entryFailure)throw new Error('Synthetic entry lookup failed');return scenario.entry||{state:'new'};}},
  '@/lib/supabase/admin':{createSupabaseAdminClient:()=>{calls.adminClient++;return adminClient;}},
  '@/lib/auth/owner-setup-readiness':{readOwnerSetupReadiness:async client=>{calls.readiness++;if(scenario.forbidReadiness)throw new Error('Existing workspace must not query the new-owner gate');if(client!==adminClient)throw new Error('Wrong readiness client');return{available:!!scenario.ready,message:'Synthetic safe setup unavailable.'};}},
  './first-owner-form':{FirstOwnerForm:'FirstOwnerForm'},
  '@/components/auth/sign-out-button':{SignOutButton:'SignOutButton'},
  '@/components/auth/setup-unavailable':{SetupUnavailable:'SetupUnavailable'},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
 const Page=require('./app/start/page.tsx').default;Module._load=original;
 const collect=tree=>{
  const forms=[],headings=[],statuses=[],gates=[];
  const text=node=>typeof node==='string'?node:Array.isArray(node)?node.map(text).join(''):node&&typeof node==='object'?text(node.props?.children):'';
  const walk=node=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;
   if(node.type==='FirstOwnerForm')forms.push({requestKey:node.props.requestKey,draftScopeKey:node.props.draftScopeKey});
   if(node.type==='h1')headings.push(text(node));
   if(node.props?.role==='status')statuses.push(text(node));
   if(node.type==='SetupUnavailable')gates.push(node.props.message);
   walk(node.props?.children);
  };walk(tree);return{forms,headings,statuses,gates};
 };
 Promise.resolve().then(()=>Page()).then(tree=>process.stdout.write(JSON.stringify({redirect:null,...collect(tree),calls}))).catch(error=>{
  if(typeof error.destination==='string')process.stdout.write(JSON.stringify({redirect:error.destination,forms:[],headings:[],statuses:[],gates:[],calls}));
  else{process.stderr.write('Page failed instead of returning a gate or deliberate redirect');process.exitCode=1;}
 });
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    redirect: string | null; forms: { requestKey: string; draftScopeKey: string }[]; headings: string[]; statuses: string[]; gates: string[];
    calls: { auth: number; userClient: number; entry: number; adminClient: number; readiness: number };
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
  assert.equal(result.forms[0].draftScopeKey, "synthetic-authenticated-owner");
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

test("anonymous ready owner entry preserves explicit start sign-in without querying membership or creating a form", () => {
  const result = startPage({ ready: true });
  assert.equal(result.redirect, "/login?next=%2Fstart"); assert.equal(result.forms.length, 0);
  assert.deepEqual(result.calls, { auth: 1, userClient: 0, entry: 0, adminClient: 1, readiness: 1 });
});

test("anonymous unavailable or unconfigured setup returns a gate instead of a login/create loop", () => {
  const unavailable = startPage({ ready: false });
  assert.equal(unavailable.redirect, null); assert.equal(unavailable.forms.length, 0); assert.deepEqual(unavailable.gates, ["Synthetic safe setup unavailable."]);
  assert.equal(unavailable.calls.entry, 0); assert.equal(unavailable.calls.readiness, 1);
  const unconfigured = startPage({ configured: false, ready: true, forbidReadiness: true });
  assert.equal(unconfigured.redirect, null); assert.equal(unconfigured.forms.length, 0); assert.equal(unconfigured.gates.length, 1);
  assert.deepEqual(unconfigured.calls, { auth: 1, userClient: 0, entry: 0, adminClient: 0, readiness: 0 });
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
