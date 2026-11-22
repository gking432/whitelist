import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = { configured?: boolean; origin?: string | null; body?: unknown; oversized?: boolean; denied?: boolean; missingCarrier?: boolean; tamperedCarrier?: boolean;
  wrongAttempt?: boolean; expired?: boolean; initialActor?: boolean; switchedActor?: boolean; loggedOut?: boolean; exchangedOtherActor?: boolean;
  actorMismatch?: boolean; finalActorMismatch?: boolean; setSessionFailure?: boolean; exchangeFailure?: boolean; replay?: boolean; currentSessionFailure?: boolean;
  dirtyExisting?: boolean; dirtyCallback?: boolean; nearExpiryExisting?: boolean; expiredExchanged?: boolean; unverifiedUser?: boolean; changedSession?: boolean; reloginNavigation?: boolean;
  startPath?: string; callbackPath?: string; callbackMethod?: string; callbackQuery?: [string, string][] };

/** Actual supabase-js and SSR implementations; every HTTP request is caught by
 * this fixture. No Auth, Google, database or provider request can escape it. */
function run(scenario: Scenario = {}) {
  const program = `
const Module=require('node:module'),original=Module._load,scenario=${JSON.stringify(scenario)};
process.env.APP_URL='https://workstation.synthetic.invalid';process.env.NEXT_PUBLIC_SUPABASE_URL='https://project.synthetic.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-anon';
process.env.SECRETS_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');process.env.GOOGLE_AUTH_ENABLED=scenario.configured===false?'false':'true';
const ssr=require('@supabase/ssr'),{NextRequest}=require('next/server'),jar=new Map(),writeSnapshots=[],readSnapshots=[],calls=[];
const ids={actor:'11111111-1111-4111-8111-111111111111',other:'22222222-2222-4222-8222-222222222222',draft:'33333333-3333-4333-8333-333333333333',key:'44444444-4444-4444-8444-444444444444',attempt:'55555555-5555-4555-8555-555555555555'};
const now=Date.now(),sessionKey='sb-project-auth-token',providerSecret='PROVIDER_ACCESS_SECRET_SHOULD_NEVER_BE_IN_SSR',providerRefresh='PROVIDER_REFRESH_SECRET_SHOULD_NEVER_BE_IN_SSR';
const user=id=>({id,aud:'authenticated',role:'authenticated',email:'synthetic@invalid.test',email_confirmed_at:scenario.unverifiedUser?null:new Date(now).toISOString(),is_anonymous:false,created_at:new Date(now).toISOString(),app_metadata:{provider:'google'},user_metadata:{role:'platform_owner',email_confirmed_at:new Date(now).toISOString()}});
const token=(id,seconds=3600,sessionId='88888888-8888-4888-8888-888888888888')=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',session_id:sessionId,iat:Math.floor(now/1000),exp:Math.floor(now/1000)+seconds})).toString('base64url'),'synthetic-signature'].join('.');
const actorFrom=authorization=>{try{return JSON.parse(Buffer.from(String(authorization).replace(/^Bearer /,'' ).split('.')[1],'base64url').toString()).sub;}catch{return null;}};
let exchanged=false,newUserReads=0,newActorChecks=0,usedCode=false,seeded=false;
const transport=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input)),headers=new Headers(init.headers),actor=actorFrom(headers.get('authorization'));
 calls.push({path:url.pathname,grant:url.searchParams.get('grant_type'),method:init.method||'GET'});
 if(url.origin!=='https://project.synthetic.invalid')throw new Error('Blocked unexpected network');
 if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='pkce'){
  const body=JSON.parse(init.body);if(!body.code_verifier||body.auth_code!=='single-use-code')throw new Error('Incorrect PKCE request');
  if(usedCode||scenario.exchangeFailure)return Response.json({error:'invalid_grant',error_description:'Synthetic private detail'},{status:400});usedCode=true;exchanged=true;
  const id=scenario.exchangedOtherActor?ids.other:ids.actor;return Response.json({access_token:token(id,scenario.expiredExchanged?-120:3600),refresh_token:'APP_REFRESH_ONLY',expires_in:scenario.expiredExchanged?-120:3600,token_type:'bearer',user:user(id),provider_token:providerSecret,provider_refresh_token:providerRefresh});
 }
 if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='refresh_token')return Response.json({access_token:token(ids.actor,3600,exchanged?'88888888-8888-4888-8888-888888888888':'66666666-6666-4666-8666-666666666666'),refresh_token:'APP_REFRESH_ROTATED',expires_in:3600,token_type:'bearer',user:user(ids.actor),provider_token:providerSecret,provider_refresh_token:providerRefresh});
 if(url.pathname==='/auth/v1/user'){
  if(exchanged)newUserReads++;
  if(scenario.currentSessionFailure&&seeded&&!exchanged||scenario.setSessionFailure&&exchanged&&newUserReads>=2)return Response.json({code:'unexpected_failure',message:'Synthetic private detail'},{status:503});
  if(!actor)throw new Error('Missing app token');return Response.json(user(actor));
 }
 if(url.pathname==='/rest/v1/rpc/current_session_actor'){if(exchanged)newActorChecks++;return Response.json(scenario.actorMismatch&&exchanged||scenario.finalActorMismatch&&newActorChecks>=2?ids.other:actor);}
 throw new Error('Blocked unexpected request');
};
const decodeSession=async cookies=>{const values=new Map(cookies.map(c=>[c.name,c.value]));const combined=await ssr.combineChunks(sessionKey,name=>values.get(name)||'');if(!combined)return'';try{return combined.startsWith('base64-')?ssr.stringFromBase64URL(combined.slice(7)):combined;}catch{return'INVALID';}};
Module._load=function(name,...args){if(name==='@supabase/ssr')return{...ssr,createServerClient:(url,key,options)=>ssr.createServerClient(url,key,{...options,cookies:{...options.cookies,getAll:async()=>{const cookies=await options.cookies.getAll();readSnapshots.push(await decodeSession(cookies));return cookies;},setAll:async(cookies,...rest)=>{const snapshot=[...(await options.cookies.getAll()).filter(c=>!cookies.some(n=>n.name===c.name)),...cookies];writeSnapshots.push(await decodeSession(snapshot));await options.cookies.setAll(cookies,...rest);}}})};return original.call(this,name,...args);};
const core=require('./lib/auth/google-onboarding.ts');Module._load=original;
const req=(url,options={})=>new NextRequest(url,{...options,headers:{...(Object.fromEntries(new Headers(options.headers))),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')}});
const apply=response=>{for(const c of response.cookies.getAll()){if(c.maxAge===0||!c.value)jar.delete(c.name);else jar.set(c.name,c.value);}};
const seed=async(id,sid='66666666-6666-4666-8666-666666666666')=>{for(const name of [...jar.keys()])if(name===sessionKey||name.startsWith(sessionKey+'.'))jar.delete(name);if(!id)return;const client=ssr.createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,'synthetic-anon',{global:{fetch:transport},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:cs=>{for(const c of cs)jar.set(c.name,c.value);}}});const result=await client.auth.setSession({access_token:token(id,scenario.nearExpiryExisting?5:3600,sid),refresh_token:'existing-refresh'});if(result.error)throw result.error;};
const dirtyJar=async()=>{const dirty=JSON.parse(await decodeSession([...jar].map(([name,value])=>({name,value}))));dirty.provider_token=providerSecret.repeat(100);dirty.provider_refresh_token=providerRefresh.repeat(100);for(const name of [...jar.keys()])if(name===sessionKey||name.startsWith(sessionKey+'.'))jar.delete(name);for(const c of ssr.createChunks(sessionKey,'base64-'+ssr.stringToBase64URL(JSON.stringify(dirty))))jar.set(c.name,c.value);};
const identity=value=>{try{const session=JSON.parse(value);return JSON.stringify({access:session.access_token,refresh:session.refresh_token,actor:session.user.id,sid:JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url')).session_id});}catch{return null;}};
(async()=>{
 if(scenario.initialActor)await seed(ids.actor);seeded=true;
 if(scenario.dirtyExisting)await dirtyJar();
 const beforeStart=await decodeSession([...jar].map(([name,value])=>({name,value}))),callsBeforeStart=calls.length;
 const start=await core.handleGoogleOnboardingStart(req('https://workstation.synthetic.invalid'+(scenario.startPath||'/auth/google/start'),{method:'POST',headers:{'Content-Type':'application/json',...(scenario.origin===null?{}:{Origin:scenario.origin||'https://workstation.synthetic.invalid'})},body:scenario.oversized?'x'.repeat(1025):JSON.stringify(scenario.body||{draftId:ids.draft,requestKey:ids.key})}),{fetch:transport,now:()=>now,randomUUID:()=>ids.attempt});
 const startBody=await start.json(),startCookies=start.cookies.getAll();apply(start);const originalCarrier=jar.get(core.GOOGLE_ONBOARDING_ATTEMPT_COOKIE);
 const out={startStatus:start.status,startError:startBody.error||null,startCache:start.headers.get('cache-control'),startUrlSafe:typeof startBody.url==='string'&&!startBody.url.includes(providerSecret)&&!startBody.url.includes('code_verifier'),identityScopes:typeof startBody.url==='string'?new URL(startBody.url).searchParams.get('scopes'):null,callbackPath:typeof startBody.url==='string'?new URL(new URL(startBody.url).searchParams.get('redirect_to')).pathname:null,cookieFlags:startCookies.filter(c=>c.value).every(c=>c.httpOnly&&c.secure&&c.sameSite==='lax'),pkce:0,callback:null,handoff:null,leaked:false,authWrites:0,replay:null,networkCalls:0};
 const afterStart=await decodeSession([...jar].map(([name,value])=>({name,value})));out.startHygiene={newCalls:calls.length-callsBeforeStart,identityPreserved:identity(beforeStart)===identity(afterStart),clean:!afterStart.includes('provider_token')&&!afterStart.includes('provider_refresh_token'),authCookies:startCookies.filter(c=>c.name===sessionKey||c.name.startsWith(sessionKey+'.')).length};
 if(start.status!==200){out.networkCalls=calls.length;process.stdout.write(JSON.stringify(out));return;}
 if(scenario.switchedActor)await seed(ids.other);if(scenario.loggedOut)await seed(null);if(scenario.changedSession)await seed(ids.actor,'77777777-7777-4777-8777-777777777777');
 if(scenario.dirtyCallback)await dirtyJar();
 if(scenario.missingCarrier)jar.delete(core.GOOGLE_ONBOARDING_ATTEMPT_COOKIE);if(scenario.tamperedCarrier)jar.set(core.GOOGLE_ONBOARDING_ATTEMPT_COOKIE,originalCarrier+'.tampered');
 const callbackUrl=new URL('https://workstation.synthetic.invalid'+(scenario.callbackPath||'/auth/google/callback'));callbackUrl.searchParams.set('attempt',scenario.wrongAttempt?ids.other:ids.attempt);callbackUrl.searchParams.set(scenario.denied?'error':'code',scenario.denied?'access_denied':'single-use-code');for(const [key,value] of scenario.callbackQuery||[])callbackUrl.searchParams.append(key,value);
 const authBeforeCallback=await decodeSession([...jar].map(([name,value])=>({name,value})));
 const callback=await core.handleGoogleOnboardingCallback(req(callbackUrl,{method:scenario.callbackMethod||'GET'}),{fetch:transport,now:()=>now+(scenario.expired?600001:0)});const callbackCookies=callback.cookies.getAll();apply(callback);
 out.callback={path:new URL(callback.headers.get('location')).pathname,outcome:new URL(callback.headers.get('location')).searchParams.get('google'),cache:callback.headers.get('cache-control'),keys:[...new URL(callback.headers.get('location')).searchParams.keys()],attemptRetired:callbackCookies.some(c=>c.name===core.GOOGLE_ONBOARDING_ATTEMPT_COOKIE&&c.maxAge===0),authCookies:callbackCookies.filter(c=>c.name===sessionKey||c.name.startsWith(sessionKey+'.')).length};
 out.existingPreserved=(await decodeSession([...jar].map(([name,value])=>({name,value})))).includes('existing-refresh');
 out.authUnchanged=authBeforeCallback===await decodeSession([...jar].map(([name,value])=>({name,value})));
 const authAfterCallback=await decodeSession([...jar].map(([name,value])=>({name,value})));out.failureHygiene={identityPreserved:identity(authBeforeCallback)===identity(authAfterCallback),clean:!authAfterCallback.includes('provider_token')&&!authAfterCallback.includes('provider_refresh_token'),staleChunksRemoved:![...jar.keys()].some(name=>name.startsWith(sessionKey+'.'))};
 const expectedSid='88888888-8888-4888-8888-888888888888',otherSid='77777777-7777-4777-8777-777777777777';
 const handoff=core.readGoogleOnboardingHandoff(jar.get(core.GOOGLE_ONBOARDING_HANDOFF_COOKIE),ids.actor,expectedSid);out.handoff=handoff?{keys:Object.keys(handoff).sort(),matches:handoff.actorId===ids.actor&&handoff.draftId===ids.draft&&handoff.requestKey===ids.key&&handoff.sessionId===expectedSid,otherRejected:core.readGoogleOnboardingHandoff(jar.get(core.GOOGLE_ONBOARDING_HANDOFF_COOKIE),ids.other,expectedSid)===null,otherSessionRejected:core.readGoogleOnboardingHandoff(jar.get(core.GOOGLE_ONBOARDING_HANDOFF_COOKIE),ids.actor,otherSid)===null}:null;
 if(handoff){const {encryptSecret}=require('./lib/integrations/secrets.ts');out.invalidHandoffRejected=[{...handoff,version:2},{...handoff,clientId:ids.other},{...handoff,sessionId:undefined},{...handoff,issuedAt:now-1200000,expiresAt:now-600000},{...handoff,issuedAt:now+60000,expiresAt:now+660000},{...handoff,expiresAt:now+1200000}].every(value=>core.readGoogleOnboardingHandoff(encryptSecret(JSON.stringify(value)),ids.actor,expectedSid)===null)&&core.readGoogleOnboardingHandoff(jar.get(core.GOOGLE_ONBOARDING_HANDOFF_COOKIE)+'.tampered',ids.actor,expectedSid)===null;}
 if(scenario.reloginNavigation){const hint=jar.get(core.GOOGLE_ONBOARDING_HANDOFF_COOKIE);const readClient=()=>ssr.createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL,'synthetic-anon',{global:{fetch:transport},cookies:{getAll:()=>[...jar].map(([name,value])=>({name,value})),setAll:()=>{throw new Error('Unexpected live proof cookie write');}}});out.liveSessionMatches=await core.readGoogleOnboardingSessionId(readClient(),ids.actor)===expectedSid;out.wrongActorSessionRejected=await core.readGoogleOnboardingSessionId(readClient(),ids.other)===null;await seed(ids.actor,otherSid);const reloginSid=await core.readGoogleOnboardingSessionId(readClient(),ids.actor);out.reloginNavigationDenied=reloginSid===otherSid&&core.readGoogleOnboardingHandoff(hint,ids.actor,reloginSid)===null;}
 if(scenario.replay){const before=calls.length;for(const name of [...jar.keys()])if(name===sessionKey||name.startsWith(sessionKey+'.'))jar.delete(name);jar.set(core.GOOGLE_ONBOARDING_ATTEMPT_COOKIE,originalCarrier);const replay=await core.handleGoogleOnboardingCallback(req(callbackUrl),{fetch:transport,now:()=>now});out.replay={outcome:new URL(replay.headers.get('location')).searchParams.get('google'),authCookies:replay.cookies.getAll().filter(c=>c.name===sessionKey||c.name.startsWith(sessionKey+'.')).length,newCalls:calls.length-before,handoffWrites:replay.cookies.getAll().filter(c=>c.name===core.GOOGLE_ONBOARDING_HANDOFF_COOKIE).length};}
 out.pkce=calls.filter(c=>c.path==='/auth/v1/token'&&c.grant==='pkce').length;out.refreshes=calls.filter(c=>c.path==='/auth/v1/token'&&c.grant==='refresh_token').length;out.networkCalls=calls.length;out.authWrites=writeSnapshots.length;out.authReads=readSnapshots.length;out.authSnapshotsValid=[...readSnapshots,...writeSnapshots].every(v=>!v||v!=='INVALID'&&typeof JSON.parse(v).access_token==='string');out.leaked=[...readSnapshots,...writeSnapshots].some(v=>v.includes(providerSecret)||v.includes(providerRefresh)||v.includes('provider_token')||v.includes('provider_refresh_token'));out.responseSecretLeak=JSON.stringify(callbackCookies).includes(providerSecret)||JSON.stringify(callbackCookies).includes(providerRefresh);out.otherRpc=calls.filter(c=>c.path.startsWith('/rest/')&&c.path!=='/rest/v1/rpc/current_session_actor').length;
 process.stdout.write(JSON.stringify(out));
})().catch(()=>{process.stderr.write('Strict synthetic Google Auth fixture failed');process.exitCode=1;});
`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 20000, maxBuffer: 150000 })) as {
    startStatus: number; startError: string | null; startCache: string; startUrlSafe: boolean; identityScopes: string; callbackPath: string; cookieFlags: boolean;
    callback: null | { path: string; outcome: string; keys: string[]; attemptRetired: boolean; authCookies: number; cache: string };
    handoff: null | { keys: string[]; matches: boolean; otherRejected: boolean; otherSessionRejected: boolean }; invalidHandoffRejected: boolean; pkce: number; refreshes: number; leaked: boolean; responseSecretLeak: boolean; authWrites: number; authReads: number; authSnapshotsValid: boolean; networkCalls: number; otherRpc: number; existingPreserved: boolean; authUnchanged: boolean;
    liveSessionMatches: boolean; wrongActorSessionRejected: boolean; reloginNavigationDenied: boolean;
    startHygiene: {newCalls:number;identityPreserved:boolean;clean:boolean;authCookies:number}; failureHygiene:{identityPreserved:boolean;clean:boolean;staleChunksRemoved:boolean};
    replay: null | { outcome: string; authCookies: number; newCalls: number; handoffWrites: number };
  };
}

test("identity-only Google start uses a fixed PKCE callback and encrypted secure carrier", () => {
  const result = run();
  assert.equal(result.startStatus, 200); assert.equal(result.startUrlSafe, true);
  assert.equal(result.identityScopes, "openid email profile"); assert.equal(result.callbackPath, "/auth/google/callback");
  assert.equal(result.cookieFlags, true); assert.match(result.startCache, /no-store/);
});

test("actual Auth exchange discards provider tokens before every real SSR cookie write", () => {
  const result = run();
  assert.equal(result.callback?.outcome, "return"); assert.equal(result.callback.path, "/start");
  assert.deepEqual(result.callback.keys, ["google"]); assert.match(result.callback.cache, /no-store/);
  assert.equal(result.pkce, 1); assert.ok(result.authWrites > 0); assert.equal(result.authSnapshotsValid, true); assert.equal(result.leaked, false); assert.equal(result.responseSecretLeak, false);
  assert.equal(result.otherRpc, 0); assert.equal(result.handoff?.matches, true); assert.equal(result.handoff.otherRejected, true);
  assert.equal(result.handoff.otherSessionRejected, true);
  assert.equal(result.invalidHandoffRejected, true);
  assert.deepEqual(result.handoff.keys, ["actorId", "attemptId", "draftId", "expiresAt", "issuedAt", "requestKey", "sessionId", "version"]);
});

test("strict origin and bounded exact JSON validation happen before Auth requests", () => {
  for (const scenario of [{ origin: null }, { origin: "https://attacker.invalid" }, { body: { draftId: "bad", requestKey: "bad" } }, { body: { draftId: "33333333-3333-4333-8333-333333333333", requestKey: "44444444-4444-4444-8444-444444444444", actorId: "injected" } }, { oversized: true }]) {
    const result = run(scenario); assert.ok([403, 422].includes(result.startStatus)); assert.equal(result.networkCalls, 0);
  }
  const unavailable = run({ configured: false }); assert.equal(unavailable.startStatus, 503); assert.equal(unavailable.startError, "google_unavailable"); assert.equal(unavailable.networkCalls, 0);
});

test("missing, tampered, expired and mismatched attempt carriers never exchange or write Auth cookies", () => {
  for (const scenario of [{ missingCarrier: true }, { tamperedCarrier: true }, { wrongAttempt: true }, { expired: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "expired"); assert.equal(result.pkce, 0);
    assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null); assert.equal(result.callback.attemptRetired, true);
  }
});

test("denial and failed single-use code exchange never create a session or adoption hint", () => {
  for (const scenario of [{ denied: true }, { exchangeFailure: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, scenario.denied ? "denied" : "failed");
    assert.equal(result.pkce, scenario.denied ? 0 : 1); assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null);
  }
});

test("exact prior actor continuity blocks background login, account switching and logout before exchange", () => {
  for (const scenario of [{ switchedActor: true }, { initialActor: true, switchedActor: true }, { initialActor: true, loggedOut: true }, { initialActor: true, changedSession: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "changed"); assert.equal(result.pkce, 0);
    assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null);
  }
  const same = run({ initialActor: true }); assert.equal(same.callback?.outcome, "return");
  const otherGoogle = run({ initialActor: true, exchangedOtherActor: true }); assert.equal(otherGoogle.callback?.outcome, "changed"); assert.equal(otherGoogle.callback.authCookies, 0);
});

test("fresh session-actor mismatch and failed SSR persistence remain fail closed without cookie commits", () => {
  for (const scenario of [{ actorMismatch: true }, { finalActorMismatch: true }, { setSessionFailure: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "failed"); assert.equal(result.pkce, 1);
    assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null); assert.equal(result.leaked, false);
  }
  const existingFailure = run({ initialActor: true, currentSessionFailure: true }); assert.equal(existingFailure.startStatus, 503); assert.equal(existingFailure.pkce, 0);
});

test("a malicious copied carrier replay only fails the already-used GoTrue code, without Auth or handoff writes", () => {
  const result = run({ replay: true }); assert.equal(result.callback?.outcome, "return"); assert.equal(result.pkce, 2);
  assert.equal(result.replay?.outcome, "failed"); assert.equal(result.replay.authCookies, 0); assert.equal(result.replay.handoffWrites, 0);
  assert.equal(result.leaked, false);
});

test("failed exchange or SSR setSession never erases an already valid app session", () => {
  for (const scenario of [{ initialActor: true, exchangeFailure: true }, { initialActor: true, setSessionFailure: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "failed"); assert.equal(result.callback.authCookies, 0);
    assert.equal(result.existingPreserved, true); assert.equal(result.handoff, null); assert.equal(result.leaked, false);
  }
});

test("inherited dirty cookies and near-expiry normal refresh responses never expose provider fields to the SSR adapter", () => {
  for (const scenario of [{ initialActor: true, dirtyExisting: true }, { initialActor: true, nearExpiryExisting: true, dirtyExisting: true }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "return");
    assert.ok(result.authReads > 0); assert.equal(result.authSnapshotsValid, true); assert.equal(result.leaked, false); assert.equal(result.responseSecretLeak, false);
    if (scenario.nearExpiryExisting) assert.ok(result.refreshes >= 1);
  }
  const failed = run({ initialActor: true, nearExpiryExisting: true, dirtyExisting: true, exchangeFailure: true });
  assert.equal(failed.callback?.outcome, "failed"); assert.equal(failed.authUnchanged, true); assert.equal(failed.callback.authCookies, 0); assert.equal(failed.leaked, false);
});

test("an expired exchanged app pair triggers real SDK refreshes while every SSR snapshot remains provider-token free", () => {
  const result = run({ expiredExchanged: true }); assert.equal(result.callback?.outcome, "return");
  assert.ok(result.refreshes >= 2); assert.equal(result.authSnapshotsValid, true); assert.equal(result.leaked, false); assert.equal(result.responseSecretLeak, false);
});

test("callback path, method, duplicate and unknown query fields fail before code exchange", () => {
  const scenarios: Scenario[] = [
    { callbackPath: "/auth/google/other" }, { callbackMethod: "HEAD" },
    { callbackQuery: [["attempt", "55555555-5555-4555-8555-555555555555"]] }, { callbackQuery: [["code", "second-code"]] },
    { callbackQuery: [["next", "https://attacker.invalid"]] }, { callbackQuery: [["draftId", "untrusted"]] }, { callbackQuery: [["email", "untrusted@invalid.test"]] },
    { callbackQuery: [["error", "access_denied"]] }, { denied: true, callbackQuery: [["error_description", "x".repeat(1025)]] },
  ];
  for (const scenario of scenarios) { const result = run(scenario); assert.equal(result.callback?.outcome, "failed"); assert.equal(result.pkce, 0); assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null); }
  for (const startPath of ["/auth/google/other", "/auth/google/start?next=https://attacker.invalid"]) {
    const result = run({ startPath }); assert.equal(result.startStatus, 422); assert.equal(result.networkCalls, 0);
  }
});

test("fresh unverified email is denied even when user_metadata claims verification", () => {
  const result = run({ unverifiedUser: true }); assert.equal(result.callback?.outcome, "failed");
  assert.equal(result.pkce, 1); assert.equal(result.callback.authCookies, 0); assert.equal(result.handoff, null);
});

test("handoff navigation requires the same freshly verified app session and rejects same-actor re-login", () => {
  const result = run({ reloginNavigation: true }); assert.equal(result.callback?.outcome, "return");
  assert.equal(result.liveSessionMatches, true); assert.equal(result.wrongActorSessionRejected, true); assert.equal(result.reloginNavigationDenied, true);
});

test("canonical failures commit only original cookie hygiene, preserving the app pair/SID and removing provider fields and stale chunks", () => {
  for (const scenario of [{ initialActor: true, dirtyCallback: true, exchangeFailure: true }, { initialActor: true, dirtyCallback: true, callbackQuery: [["next", "https://attacker.invalid"]] as [string, string][] }]) {
    const result = run(scenario); assert.equal(result.callback?.outcome, "failed"); assert.equal(result.handoff, null);
    assert.equal(result.failureHygiene.identityPreserved, true); assert.equal(result.failureHygiene.clean, true); assert.equal(result.failureHygiene.staleChunksRemoved, true);
  }
  for (const scenario of [{ configured: false }, { body: { invalid: true } }]) {
    const result = run({ initialActor: true, dirtyExisting: true, ...scenario });
    assert.ok([422, 503].includes(result.startStatus)); assert.equal(result.startHygiene.newCalls, 0); assert.equal(result.startHygiene.identityPreserved, true); assert.equal(result.startHygiene.clean, true); assert.ok(result.startHygiene.authCookies > 0);
  }
  const foreign = run({ initialActor: true, dirtyExisting: true, origin: "https://foreign.invalid" });
  assert.equal(foreign.startStatus, 403); assert.equal(foreign.startHygiene.newCalls, 0); assert.equal(foreign.startHygiene.authCookies, 0); assert.equal(foreign.startHygiene.identityPreserved, true); assert.equal(foreign.startHygiene.clean, false);
});
