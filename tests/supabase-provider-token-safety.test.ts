// Protocol fixtures: production factories and the installed SSR/AuthJS SDKs
// execute against a closed transport. These are not live Auth/provider proofs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Surface = "server" | "browser" | "proxy" | "old_callback";
type Operation = "inherited" | "refresh" | "code" | "otp";
type InvalidCarrier = "orphan" | "gap" | "mixed" | "malformed_base64" | "malformed_json" | "nonobject";
type Observation = {
  resultOk: boolean; finalClean: boolean; finalAppFields: boolean; finalUser: boolean; untouchedCookie: boolean; obsoleteChunksRemoved: boolean;
  initialChunks: number; proactiveWrites: number; sdkReads: number; sdkWrites: number; sdkReadsClean: boolean; sdkWritesClean: boolean; authEventsClean: boolean;
  destinationWritesClean: boolean; returnedSessionClean: boolean; localStorageClean: boolean; factoryCount: number; callbackPath: string | null;
  sdkAuthCarriersAbsent: boolean; finalAuthCarrierAbsent: boolean; verifierPreserved: boolean; resultSessionAbsent: boolean;
  proxyStatus: number | null; proxyLocation: string | null;
  calls: { path: string; method: string; grant: string | null }[];
};
function exercise(surface: Surface, operation: Operation, legacyRaw = false, invalidCarrier: InvalidCarrier | null = null, proxyPath = "/client/onboarding"): Observation {
  const source = `
const Module=require('node:module'),originalLoad=Module._load,surface=${JSON.stringify(surface)},operation=${JSON.stringify(operation)},legacyRaw=${JSON.stringify(legacyRaw)},invalidCarrier=${JSON.stringify(invalidCarrier)},proxyPath=${JSON.stringify(proxyPath)};
process.env.APP_URL='https://workstation.synthetic.invalid';process.env.NEXT_PUBLIC_SUPABASE_URL='https://project.synthetic.invalid';process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='synthetic-public-key';
const ssr=require('@supabase/ssr'),{NextRequest,NextResponse}=require('next/server'),project=process.env.NEXT_PUBLIC_SUPABASE_URL,key='sb-project-auth-token';
const jar=new Map(),cookieWrites=[],sdkReads=[],sdkReadHasCarrier=[],sdkWrites=[],authEvents=[],clients=[],calls=[],browserStorage=new Map(),browserStorageWrites=[];let factoryCount=0,record=true,fixturePhase='setup';
const now=Math.floor(Date.now()/1000),actor='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
const providerAccess='PROVIDER_ACCESS_NEVER_PERSIST_'+ 'A'.repeat(6000),providerRefresh='PROVIDER_REFRESH_NEVER_PERSIST_'+ 'B'.repeat(2500);
const jwt=seconds=>[Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:actor,role:'authenticated',session_id:sid,iat:now,exp:now+seconds})).toString('base64url'),'synthetic-signature'].join('.');
const user={id:actor,aud:'authenticated',role:'authenticated',email:'owner@synthetic.invalid',email_confirmed_at:new Date().toISOString(),is_anonymous:false,created_at:new Date().toISOString(),app_metadata:{provider:'google'},user_metadata:{safe_fixture:true}};
// Explicit refresh methods start with a valid session, so initialization cannot
// consume the refresh before the method under test. The proxy must recover an
// expired cookie through its actual getUser path.
const expired=surface==='proxy'&&operation==='refresh',currentToken=jwt(expired?-120:3600),newToken=jwt(7200);
const oldSession={access_token:currentToken,refresh_token:'APP_REFRESH_CURRENT',expires_at:now+(expired?-120:3600),expires_in:3600,token_type:'bearer',user,provider_token:providerAccess,provider_refresh_token:providerRefresh};
const pairs=store=>[...store].map(([name,value])=>({name,value}));
const decode=cookies=>{const values=new Map(cookies.filter(c=>c.value).map(c=>[c.name,c.value]));const full=values.get(key);let combined=full||'';if(!full)for(let i=0;values.has(key+'.'+i);i++)combined+=values.get(key+'.'+i);if(!combined)return null;try{return JSON.parse(combined.startsWith('base64-')?ssr.stringFromBase64URL(combined.slice(7)):combined)}catch{return{invalid:true}}};
const clean=value=>value===null||!!value&&!value.invalid&&!Object.hasOwn(value,'provider_token')&&!Object.hasOwn(value,'provider_refresh_token')&&!JSON.stringify(value).includes('PROVIDER_ACCESS_NEVER_PERSIST')&&!JSON.stringify(value).includes('PROVIDER_REFRESH_NEVER_PERSIST');
const merge=(cookies,updates)=>{const result=new Map(cookies.map(c=>[c.name,c.value]));for(const c of updates){if(!c.value||c.options?.maxAge===0)result.delete(c.name);else result.set(c.name,c.value)}return pairs(result)};
const apply=(name,value,options={})=>{if(!value||options.maxAge===0)jar.delete(name);else jar.set(name,value);if(record)cookieWrites.push({name,value,options})};
const encodedOld='base64-'+ssr.stringToBase64URL(JSON.stringify(oldSession)),oldChunks=ssr.createChunks(key,legacyRaw?JSON.stringify(oldSession):encodedOld);
for(const c of oldChunks)jar.set(c.name,c.value);
if(invalidCarrier){jar.clear();if(invalidCarrier==='orphan')jar.set(key+'.2',encodedOld);else if(invalidCarrier==='gap'){jar.set(key+'.0',oldChunks[0].value);jar.set(key+'.2',oldChunks[2].value)}else if(invalidCarrier==='mixed'){jar.set(key,encodedOld);jar.set(key+'.0',oldChunks[0].value)}else if(invalidCarrier==='malformed_base64')jar.set(key,'base64-%%%PROVIDER_ACCESS_NEVER_PERSIST');else if(invalidCarrier==='malformed_json')jar.set(key,'{"provider_token":"PROVIDER_ACCESS_NEVER_PERSIST"');else jar.set(key,'base64-'+ssr.stringToBase64URL(JSON.stringify(['PROVIDER_ACCESS_NEVER_PERSIST'])))}
const initialNames=[...jar.keys()],initialChunks=initialNames.length;jar.set('workstation-local-fixture','unchanged');
const verifier='base64-'+ssr.stringToBase64URL(JSON.stringify('synthetic-pkce-verifier'));
if(operation==='code'||invalidCarrier)jar.set(key+'-code-verifier',verifier);
const requestTransport=async(input,init={})=>{
 const url=new URL(typeof input==='string'?input:input.url||String(input)),method=init.method||'GET';calls.push({path:url.pathname,method,grant:url.searchParams.get('grant_type')});
 if(url.origin!==project)throw new Error('Closed fixture blocked unexpected origin');
 if(url.pathname==='/auth/v1/token'){
  const body=JSON.parse(init.body||'{}'),grant=url.searchParams.get('grant_type');
  if(grant==='pkce'&&(body.auth_code!=='single-use-fixture-code'||body.code_verifier!=='synthetic-pkce-verifier'))throw new Error('Incorrect actual SDK PKCE protocol');
  if(grant!=='pkce'&&grant!=='refresh_token')throw new Error('Unexpected actual SDK grant');
  if(grant==='refresh_token'&&body.refresh_token!=='APP_REFRESH_CURRENT')throw new Error('Actual app refresh token was changed');
  return Response.json({access_token:newToken,refresh_token:'APP_REFRESH_NEW',expires_in:7200,token_type:'bearer',user,provider_token:providerAccess,provider_refresh_token:providerRefresh});
 }
 if(url.pathname==='/auth/v1/verify'){const body=JSON.parse(init.body||'{}');if(body.token_hash!=='synthetic-otp-hash'||body.type!=='email')throw new Error('Incorrect actual SDK OTP protocol');return Response.json({access_token:newToken,refresh_token:'APP_REFRESH_NEW',expires_in:7200,token_type:'bearer',user,provider_token:providerAccess,provider_refresh_token:providerRefresh});}
 if(url.pathname==='/auth/v1/user')return Response.json(user);
 throw new Error('Closed fixture blocked unexpected endpoint');
};global.fetch=requestTransport;
const documentMock={visibilityState:'visible',addEventListener(){},removeEventListener(){}};
Object.defineProperty(documentMock,'cookie',{get:()=>pairs(jar).map(c=>ssr.serializeCookieHeader(c.name,c.value,{}).split(';')[0]).join('; '),set:raw=>{const c=ssr.parseCookieHeader(raw.split(';')[0])[0];if(c)apply(c.name,c.value||'',{maxAge:/max-age=0(?:;|$)/i.test(raw)?0:undefined})}});
const localStorage={getItem:k=>browserStorage.get(k)||null,setItem:(k,v)=>{browserStorageWrites.push(String(v));browserStorage.set(k,String(v))},removeItem:k=>browserStorage.delete(k)};
if(surface==='browser'){
 const windowMock={document:documentMock,localStorage,sessionStorage:localStorage,location:{href:'https://workstation.synthetic.invalid/auth/confirm',hash:'',search:''},history:{state:null,replaceState(){}},addEventListener(){},removeEventListener(){}};
 global.window=windowMock;global.document=documentMock;Object.defineProperty(global,'navigator',{value:{},configurable:true});
}
const wrap=(factory)=>(url,anon,options={})=>{
 factoryCount++;const original=options.cookies;
 const wrapped=original?{...original,getAll:async()=>{const cookies=await original.getAll();sdkReads.push(decode(cookies));sdkReadHasCarrier.push(cookies.some(cookie=>ssr.isChunkLike(cookie.name,key)));return cookies},setAll:async(updates,...rest)=>{sdkWrites.push(decode(merge(await original.getAll(),updates)));return original.setAll(updates,...rest)}}:undefined;
 const client=factory(url,anon,{...options,...(wrapped?{cookies:wrapped}:{})});clients.push(client);
 client.auth.onAuthStateChange((_event,session)=>{authEvents.push(session?JSON.parse(JSON.stringify(session)):null)});return client;
};
const cookieStore={getAll:()=>pairs(jar),set:(name,value,options)=>apply(name,value,options)};
Module._load=function(name,...args){if(name==='next/headers')return{cookies:async()=>cookieStore};if(name==='@supabase/ssr')return{...ssr,createServerClient:wrap(ssr.createServerClient),createBrowserClient:wrap(ssr.createBrowserClient)};return originalLoad.call(this,name,...args)};
(async()=>{
 let result,callbackPath=null,proactiveWrites=0,proxyStatus=null,proxyLocation=null;
 if(surface==='proxy'){
  fixturePhase='proxy_request';
  const request=new NextRequest('https://workstation.synthetic.invalid'+proxyPath,{headers:{Cookie:pairs(jar).map(c=>c.name+'='+encodeURIComponent(c.value)).join('; ')}});
  const actualNext=NextResponse.next;
  NextResponse.next=function(...args){const response=actualNext.apply(this,args),cookies=response.cookies,set=cookies.set.bind(cookies);Object.defineProperty(response,'cookies',{value:new Proxy(cookies,{get(target,prop){if(prop==='set')return(name,value,options)=>{const c=typeof name==='object'?name:{name,value,...options};cookieWrites.push({name:c.name,value:c.value,options:c});return set(name,value,options)};return Reflect.get(target,prop)}})});return response};
  fixturePhase='proxy_import';const {proxy}=require('./proxy.ts');Module._load=originalLoad;fixturePhase='proxy_execute';const response=await proxy(request);proxyStatus=response.status;proxyLocation=response.headers.get('location')?new URL(response.headers.get('location')).pathname:null;
  // Only the final response crosses the network; discarded response objects
  // must not be mistaken for a committed inherited-cookie cleanup.
  for(const c of response.cookies.getAll())apply(c.name,c.value,c);result={error:null,data:{session:decode(pairs(jar))}};proactiveWrites=operation==='inherited'?cookieWrites.length:0;
 }else if(surface==='old_callback'){
  const {GET}=require('./app/auth/callback/route.ts');Module._load=originalLoad;const response=await GET(new Request('https://workstation.synthetic.invalid/auth/callback?code=single-use-fixture-code&next=%2Fclient%2Fonboarding'));callbackPath=new URL(response.headers.get('location')).pathname;result={error:null,data:{session:decode(pairs(jar))}};
 }else{
  const factory=surface==='browser'?require('./lib/supabase/client.ts').createSupabaseBrowserClient:require('./lib/supabase/server.ts').createSupabaseServerClient;Module._load=originalLoad;
  const client=await factory();proactiveWrites=cookieWrites.length;
  if(operation==='inherited')result=await client.auth.getSession();
  else if(operation==='refresh')result=await client.auth.refreshSession();
  else if(operation==='code')result=await client.auth.exchangeCodeForSession('single-use-fixture-code');
  else result=await client.auth.verifyOtp({token_hash:'synthetic-otp-hash',type:'email'});
 }
 await new Promise(resolve=>setImmediate(resolve));
 for(const client of clients){await client.auth.stopAutoRefresh();client.auth.broadcastChannel?.close()}
 const final=decode(pairs(jar)),expectedToken=operation==='inherited'?currentToken:newToken,expectedRefresh=operation==='inherited'?'APP_REFRESH_CURRENT':'APP_REFRESH_NEW';
 // Every nonempty destination auth-cookie write must be a chunk of an
 // independently observed clean session, including intermediary responses.
 const allowedWrites=new Set([...sdkReads,...sdkWrites,...authEvents,final].filter(value=>value&&clean(value)).flatMap(value=>ssr.createChunks(key,'base64-'+ssr.stringToBase64URL(JSON.stringify(value))).map(cookie=>cookie.name+'='+cookie.value)));
 const destinationWritesClean=cookieWrites.filter(cookie=>cookie.value&&ssr.isChunkLike(cookie.name,key)).every(cookie=>allowedWrites.has(cookie.name+'='+cookie.value));
 process.stdout.write(JSON.stringify({resultOk:!result.error,finalClean:clean(final),finalAppFields:final?.access_token===expectedToken&&final?.refresh_token===expectedRefresh&&typeof final?.expires_at==='number'&&final?.token_type==='bearer',finalUser:final?.user?.id===actor&&final?.user?.app_metadata?.provider==='google'&&final?.user?.user_metadata?.safe_fixture===true,untouchedCookie:jar.get('workstation-local-fixture')==='unchanged',obsoleteChunksRemoved:initialNames.some(name=>!jar.has(name)),initialChunks,proactiveWrites,sdkReads:sdkReads.length,sdkWrites:sdkWrites.length,sdkReadsClean:sdkReads.every(clean),sdkWritesClean:sdkWrites.every(clean),authEventsClean:authEvents.every(clean),destinationWritesClean,returnedSessionClean:clean(result.data?.session??null),localStorageClean:[...browserStorageWrites,...browserStorage.values()].every(value=>!value.includes('provider_token')&&!value.includes('provider_refresh_token')&&!value.includes('PROVIDER_')),sdkAuthCarriersAbsent:sdkReadHasCarrier.every(value=>!value),finalAuthCarrierAbsent:!pairs(jar).some(cookie=>ssr.isChunkLike(cookie.name,key)),verifierPreserved:jar.get(key+'-code-verifier')===verifier,resultSessionAbsent:result.data?.session===null,factoryCount,callbackPath,proxyStatus,proxyLocation,calls}));
})().catch(async error=>{for(const client of clients){await client.auth.stopAutoRefresh();client.auth.broadcastChannel?.close()}process.stderr.write(JSON.stringify({fixtureFailed:true,phase:fixturePhase,errorName:error?.name,site:error?.stack?.split('\\n').slice(1,2)}));process.exitCode=1});`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 })) as Observation;
}
function cleanPersistence(value: Observation) {
  assert.equal(value.resultOk, true); assert.equal(value.factoryCount, 1); assert.ok(value.initialChunks >= 2);
  for (const key of ["finalClean", "finalAppFields", "finalUser", "untouchedCookie", "obsoleteChunksRemoved", "sdkReadsClean", "sdkWritesClean", "authEventsClean", "destinationWritesClean", "returnedSessionClean", "localStorageClean"] as const) assert.equal(value[key], true, key);
  assert.ok(value.sdkReads > 0);
}
test("production server/browser factories proactively rewrite inherited dirty chunks without an SDK refresh", () => {
  for (const surface of ["server", "browser"] as const) {
    for (const legacyRaw of [false, true]) {
      const value = exercise(surface, "inherited", legacyRaw); cleanPersistence(value); assert.ok(value.proactiveWrites > 0); assert.deepEqual(value.calls, []);
    }
  }
});
test("production server/browser/proxy factories retire invalid inherited carriers before any SDK read or Auth request", () => {
  for (const surface of ["server", "browser", "proxy"] as const) {
    for (const carrier of ["orphan", "gap", "mixed", "malformed_base64", "malformed_json", "nonobject"] as const) {
      const value = exercise(surface, "inherited", false, carrier);
      assert.equal(value.resultOk, true, `${surface}/${carrier}`); assert.equal(value.factoryCount, 1); assert.ok(value.sdkReads > 0); assert.ok(value.proactiveWrites > 0);
      for (const key of ["sdkAuthCarriersAbsent", "finalAuthCarrierAbsent", "verifierPreserved", "resultSessionAbsent", "untouchedCookie", "sdkReadsClean", "destinationWritesClean", "authEventsClean", "localStorageClean"] as const) assert.equal(value[key], true, `${surface}/${carrier}/${key}`);
      assert.deepEqual(value.calls, [], `${surface}/${carrier}: no Auth request for invalid cookies`);
    }
  }
});
test("actual public proxy early returns retire invalid carriers without Auth or changing public routing", () => {
  for (const [path, status, location] of [["/start", 200, null], ["/login", 307, "/preview"], ["/preview/apps", 200, null], ["/client", 307, "/preview"]] as const) {
    for (const carrier of ["orphan", "gap", "mixed", "malformed_base64", "malformed_json", "nonobject"] as const) {
      const value = exercise("proxy", "inherited", false, carrier, path);
      assert.equal(value.proxyStatus, status, `${path}/${carrier}`); assert.equal(value.proxyLocation, location); assert.equal(value.factoryCount, 0); assert.equal(value.sdkReads, 0); assert.ok(value.proactiveWrites > 0);
      for (const key of ["finalAuthCarrierAbsent", "verifierPreserved", "resultSessionAbsent", "untouchedCookie", "destinationWritesClean"] as const) assert.equal(value[key], true, `${path}/${carrier}/${key}`);
      assert.deepEqual(value.calls, []);
    }
  }
});
test("production server factory strips provider fields before real AuthJS refresh, code exchange and OTP storage/events", () => {
  for (const operation of ["refresh", "code", "otp"] as const) {
    const value = exercise("server", operation); cleanPersistence(value); assert.ok(value.sdkWrites > 0);
    assert.equal(value.calls.filter(call => operation === "otp" ? call.path === "/auth/v1/verify" : call.path === "/auth/v1/token" && call.grant === (operation === "code" ? "pkce" : "refresh_token")).length, 1);
  }
});
test("production browser factory strips provider fields before real AuthJS refresh, code exchange and OTP cookie/localStorage writes", () => {
  for (const operation of ["refresh", "code", "otp"] as const) {
    const value = exercise("browser", operation); cleanPersistence(value); assert.ok(value.sdkWrites > 0);
    assert.equal(value.calls.filter(call => operation === "otp" ? call.path === "/auth/v1/verify" : call.path === "/auth/v1/token" && call.grant === (operation === "code" ? "pkce" : "refresh_token")).length, 1);
  }
});
test("the actual proxy commits inherited cleanup and fresh-session cleanup in its final response", () => {
  for (const operation of ["inherited", "refresh"] as const) {
    const value = exercise("proxy", operation); cleanPersistence(value); assert.ok(value.proactiveWrites > 0 || value.sdkWrites > 0);
    assert.equal(value.calls.filter(call => call.grant === "refresh_token").length, operation === "refresh" ? 1 : 0);
    assert.ok(value.calls.some(call => call.path === "/auth/v1/user"));
  }
});
test("the existing generic auth callback uses the protected production server factory and cannot persist provider fields", () => {
  const value = exercise("old_callback", "code"); cleanPersistence(value); assert.equal(value.callbackPath, "/client/onboarding");
  assert.ok(value.sdkWrites > 0); assert.equal(value.calls.filter(call => call.path === "/auth/v1/token" && call.grant === "pkce").length, 1);
});
