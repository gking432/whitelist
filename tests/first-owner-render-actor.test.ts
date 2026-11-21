import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const owner = "11111111-1111-4111-8111-111111111111";
function submit(options: { expected?: string | null; current?: string; verified?: boolean; origin?: string } = {}) {
  const program = `
 const Module=require('node:module'),original=Module._load,options=${JSON.stringify(options)},calls={auth:0,provision:0};
 const client={auth:{getUser:async()=>{calls.auth++;return {error:null,data:{user:{id:options.current||${JSON.stringify(owner)},is_anonymous:false,email_confirmed_at:options.verified===false?null:'2026-11-21'}}};}}};
 const mocks={
 'next/navigation':{redirect:destination=>{throw{destination}}},'next/headers':{headers:async()=>new Headers({origin:options.origin||'https://workspace.test'})},
 '@/lib/env':{getAppUrl:()=> 'https://workspace.test'},
 '@/lib/supabase/server':{createSupabaseServerClient:async()=>client},
 '@/lib/auth/first-owner':{provisionFirstOwner:async(client,input)=>{calls.provision++;calls.key=input.key;return{destination:'/client/onboarding'}}},
 };Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args)};const {createFirstOwnerBusiness}=require('./app/start/actions.ts');Module._load=original;
 const form=new FormData();form.set('key','22222222-2222-4222-8222-222222222222');form.set('name','Owner business');form.set('description','Owner declared business details.');form.set('timezone','America/Chicago');if(options.expected!==null)form.set('expectedActor',options.expected||${JSON.stringify(owner)});
 createFirstOwnerBusiness({status:'idle'},form).then(result=>console.log(JSON.stringify({result,calls}))).catch(error=>console.log(JSON.stringify({destination:error.destination,calls})));
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as { result?: { status: string; message: string }; destination?: string; calls: { auth: number; provision: number; key?: string } };
}
test("first-owner creation binds a rendered draft to the freshly verified actor without supplying identity to provisioning", () => {
  const result = submit(); assert.equal(result.destination, "/client/onboarding"); assert.equal(result.calls.auth, 1); assert.equal(result.calls.provision, 1);
  assert.equal(result.calls.key, "22222222-2222-4222-8222-222222222222");
});
test("an old tab cannot provision the previous actor's draft after account switching or without a render pin", () => {
  for (const expected of [null, "33333333-3333-4333-8333-333333333333", "not-an-actor"]) {
    const result = submit({ expected }); assert.equal(result.calls.auth, 1); assert.equal(result.calls.provision, 0); assert.equal(result.result?.status, "error"); assert.match(result.result?.message ?? "", /sign-in changed/);
  }
  const signedOut = submit({ verified: false }); assert.equal(signedOut.calls.provision, 0); assert.match(signedOut.result?.message ?? "", /verified email/);
  const origin = submit({ origin: "https://foreign.test" }); assert.equal(origin.calls.auth, 0); assert.equal(origin.calls.provision, 0);
});
