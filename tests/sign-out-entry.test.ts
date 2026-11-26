import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = { origin?: string | null; missingClient?: boolean; clientThrow?: boolean; sdkError?: boolean; sdkThrow?: boolean };
function executeSignOut(scenario: Scenario = {}) {
  const program = `
 const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)},events=[],calls={headers:0,client:0,signOut:0,redirect:0,options:[]};
 const mocks={
  'next/headers':{headers:async()=>{calls.headers++;events.push('headers');return new Headers({Host:'untrusted-host.invalid','X-Forwarded-Host':'untrusted-forwarded.invalid',Referer:'https://unrelated.invalid/next',...(scenario.origin===null?{}:{Origin:scenario.origin??'https://workstation.invalid'})});}},
  'next/navigation':{redirect:destination=>{calls.redirect++;events.push('redirect');throw Object.assign(new Error('Synthetic Next redirect'),{destination});}},
  '@/lib/env':{getAppUrl:()=> 'https://workstation.invalid'},
  '@/lib/auth/first-owner-rules':require('./lib/auth/first-owner-rules.ts'),
  '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;events.push('client');if(scenario.clientThrow)throw new Error('Synthetic client creation failure');if(scenario.missingClient)return null;return{auth:{signOut:async options=>{calls.signOut++;calls.options.push(options);events.push('signOut');await new Promise(resolve=>setImmediate(resolve));if(scenario.sdkThrow)throw new Error('Synthetic Auth transport failure');events.push('sdkCompleted');return{error:scenario.sdkError?{message:'Synthetic provider failure'}:null};}}};}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
 const {signOut}=require('./app/auth/actions.ts');Module._load=original;
 Promise.resolve().then(()=>signOut()).then(()=>process.stdout.write(JSON.stringify({returned:true,failed:false,redirect:null,events,calls}))).catch(error=>{
  process.stdout.write(JSON.stringify({returned:false,failed:typeof error.destination!=='string',redirect:typeof error.destination==='string'?error.destination:null,events,calls}));
 });
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    returned: boolean; failed: boolean; redirect: string | null; events: string[];
    calls: { headers: number; client: number; signOut: number; redirect: number; options: unknown[] };
  };
}

test("successful real sign-out action awaits exactly one local SDK sign-out and redirects directly to preview", () => {
  const result = executeSignOut();
  assert.equal(result.failed, false); assert.equal(result.returned, false); assert.equal(result.redirect, "/preview");
  assert.deepEqual(result.calls, { headers: 1, client: 1, signOut: 1, redirect: 1, options: [{ scope: "local" }] });
  assert.deepEqual(result.events, ["headers", "client", "signOut", "sdkCompleted", "redirect"]);
});

test("missing or noncanonical origin fails before creating a client or signing out", () => {
  for (const origin of [null, "https://unrelated.invalid", "http://workstation.invalid", "https://workstation.invalid:8443", "https://workstation.invalid.attacker.invalid", "not-an-origin"]) {
    const result = executeSignOut({ origin });
    assert.equal(result.failed, true); assert.equal(result.returned, false); assert.equal(result.redirect, null);
    assert.deepEqual(result.calls, { headers: 1, client: 0, signOut: 0, redirect: 0, options: [] });
    assert.deepEqual(result.events, ["headers"]);
  }
});

test("missing or failed client creation never manufactures a successful sign-out redirect", () => {
  for (const scenario of [{ missingClient: true }, { clientThrow: true }]) {
    const result = executeSignOut(scenario);
    assert.equal(result.failed, true); assert.equal(result.returned, false); assert.equal(result.redirect, null);
    assert.deepEqual(result.calls, { headers: 1, client: 1, signOut: 0, redirect: 0, options: [] });
  }
});

test("SDK errors and transport throws do not redirect, retry or change local session-revocation scope", () => {
  for (const scenario of [{ sdkError: true }, { sdkThrow: true }]) {
    const result = executeSignOut(scenario);
    assert.equal(result.failed, true); assert.equal(result.returned, false); assert.equal(result.redirect, null);
    assert.deepEqual(result.calls, { headers: 1, client: 1, signOut: 1, redirect: 0, options: [{ scope: "local" }] });
    assert.equal(result.events.includes("redirect"), false);
  }
});
