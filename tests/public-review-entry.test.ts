import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { hasPossibleSessionCookie, hasPrivateSignInIntent, publicReviewDestination, supabaseAuthCookieName } from "../lib/auth/public-review-entry.ts";

test("only exact public entry paths redirect, and explicit private intent includes empty values", () => {
  for (const path of ["/", "/client", "/login"]) assert.equal(publicReviewDestination(path), "/preview");
  for (const path of ["/preview", "/preview/messages", "/client/", "/client/messages", "/client/apps", "/start", "/auth/confirm", "/api/business/context", "/api/integrations/stripe", "/partner", "/unknown", "//client", "/CLIENT", "/client?next=/start"]) assert.equal(publicReviewDestination(path), null, path);
  assert.equal(hasPrivateSignInIntent({}), false);
  for (const intent of [{ next: "/start" }, { next: "" }, { error: "" }, { error: "expired" }, { agency: "" }, { agency: "business" }]) assert.equal(hasPrivateSignInIntent(intent), true);
  // Intent never turns untrusted next into a public redirect destination.
  assert.equal(hasPrivateSignInIntent({ next: "https://unrelated.invalid" }), true);
});

test("cookie hints match the installed SDK's configured project for hosted and loopback URLs", () => {
  for (const [url, key] of [["https://project.supabase.co", "sb-project-auth-token"], ["http://127.0.0.1:54321", "sb-127-auth-token"], ["http://localhost:54321", "sb-localhost-auth-token"]]) {
    assert.equal(supabaseAuthCookieName(url), key);
    assert.equal(hasPossibleSessionCookie([{ name: key, value: "untrusted-carrier" }], url), true);
    assert.equal(hasPossibleSessionCookie([{ name: `${key}.1`, value: "second" }, { name: `${key}.0`, value: "first" }], url), true);
    assert.equal(hasPossibleSessionCookie([{ name: key, value: "untrusted-carrier" }, { name: "unrelated", value: "other" }], url), true);
  }
  for (const url of [undefined, "", "not a URL", "file:///tmp/anything", "https://user:password@project.supabase.co"]) assert.equal(supabaseAuthCookieName(url), null);
});

test("foreign, verifier-only, empty, duplicated, mixed and discontinuous cookies are not session hints", () => {
  const key = "sb-project-auth-token", url = "https://project.supabase.co";
  for (const cookies of [[], [{ name: "sb-foreign-auth-token", value: "carrier" }], [{ name: `${key}-code-verifier`, value: "verifier" }],
    [{ name: key, value: "" }], [{ name: key, value: "   " }], [{ name: key, value: "a" }, { name: key, value: "a" }],
    [{ name: key, value: "a" }, { name: `${key}.0`, value: "b" }], [{ name: `${key}.1`, value: "b" }],
    [{ name: `${key}.0`, value: "a" }, { name: `${key}.2`, value: "b" }], [{ name: `${key}.0`, value: "a" }, { name: `${key}.1`, value: "" }],
    [{ name: `${key}.01`, value: "a" }], [{ name: `${key}.invalid`, value: "a" }], [{ name: `${key}.9007199254740992`, value: "a" }]]) assert.equal(hasPossibleSessionCookie(cookies, url), false);
  assert.equal(hasPossibleSessionCookie([{ name: key, value: "a" }]), false);
});

type Scenario = { path: string; method?: string; cookies?: string; rawUrl?: string | null; forbidEnv?: boolean; missingEnv?: boolean; user?: boolean; authError?: boolean; throwAuth?: boolean; refresh?: boolean };
function runProxy(scenario: Scenario) {
  const program = `
 const Module=require('node:module'), original=Module._load, scenario=${JSON.stringify(scenario)}, calls={env:0,client:0,user:0};
 if(scenario.rawUrl===null) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=scenario.rawUrl||'https://project.supabase.co';
 const mocks={
  '@/lib/env':{getSupabasePublicEnv:()=>{calls.env++;if(scenario.forbidEnv)throw new Error('Unexpected environment lookup');return scenario.missingEnv?null:{url:process.env.NEXT_PUBLIC_SUPABASE_URL,anonKey:'synthetic-public-key'};}},
  '@/lib/auth/public-review-entry':require('./lib/auth/public-review-entry.ts'),
  '@supabase/ssr':{createServerClient:(_url,_key,options)=>{calls.client++;return{auth:{getUser:async()=>{calls.user++;if(scenario.refresh)options.cookies.setAll([{name:'sb-project-auth-token',value:'synthetic-refreshed-carrier',options:{path:'/',sameSite:'lax'}}]);if(scenario.throwAuth)throw new Error('Synthetic Auth transport failure');return{data:{user:scenario.user?{id:'synthetic-verified-user'}:null},error:scenario.authError?{code:'invalid_token'}:null};}}};}},
 };
 Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
 const {proxy}=require('./proxy.ts');Module._load=original;
 const {NextRequest}=require('next/server');
 const request=new NextRequest('https://workstation.invalid'+scenario.path,{method:scenario.method||'GET',headers:scenario.cookies?{Cookie:scenario.cookies}:{}});
 proxy(request).then(response=>process.stdout.write(JSON.stringify({status:response.status,location:response.headers.get('location'),cache:response.headers.get('cache-control'),vary:response.headers.get('vary'),next:response.headers.get('x-middleware-next'),cookies:response.cookies.getAll().map(({name,value})=>({name,value})),calls}))).catch(()=>process.stdout.write(JSON.stringify({threw:true,calls})));
 `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as {
    status?: number; location?: string | null; cache?: string | null; vary?: string | null; next?: string | null; cookies?: { name: string; value: string }[]; threw?: boolean; calls: { env: number; client: number; user: number };
  };
}
function assertPreview(result: ReturnType<typeof runProxy>) {
  assert.equal(result.threw, undefined); assert.equal(result.status, 307); assert.equal(result.location, "https://workstation.invalid/preview");
  assert.equal(result.cache, "private, no-store"); assert.equal(result.vary, "Cookie");
}

test("anonymous GET/HEAD entry and bare login skip environment/Auth entirely without configuration", () => {
  for (const path of ["/", "/client", "/login", "/client?next=https://unrelated.invalid", "/login?unrelated=value"]) {
    const result = runProxy({ path, rawUrl: null, forbidEnv: true }); assertPreview(result); assert.deepEqual(result.calls, { env: 0, client: 0, user: 0 });
  }
  assertPreview(runProxy({ path: "/client", method: "HEAD", rawUrl: null, forbidEnv: true }));
  const bareLogin = runProxy({ path: "/login", user: true, cookies: "sb-project-auth-token=untrusted-carrier", forbidEnv: true });
  assertPreview(bareLogin); assert.deepEqual(bareLogin.calls, { env: 0, client: 0, user: 0 });
});

test("explicit next/start, error and agency sign-in retain the original private login path", () => {
  for (const path of ["/login?next=%2Fstart", "/login?next=", "/login?error=expired", "/login?agency=example"]) {
    const result = runProxy({ path }); assert.equal(result.status, 200); assert.equal(result.next, "1"); assert.equal(result.location, null); assert.deepEqual(result.calls, { env: 1, client: 1, user: 1 });
  }
});

test("cookie carriers are hints only: stale/error hints go public and verified client still continues to private loaders", () => {
  for (const patch of [{}, { authError: true }, { throwAuth: true }]) {
    const result = runProxy({ path: "/client", cookies: "sb-project-auth-token=untrusted-carrier", ...patch });
    assertPreview(result); assert.deepEqual(result.calls, { env: 1, client: 1, user: 1 });
  }
  const foreign = runProxy({ path: "/client", cookies: "sb-foreign-auth-token=carrier", forbidEnv: true }); assertPreview(foreign); assert.equal(foreign.calls.user, 0);
  const missing = runProxy({ path: "/client", cookies: "sb-project-auth-token=carrier", missingEnv: true }); assertPreview(missing); assert.equal(missing.calls.client, 0);
  for (const cookies of ["sb-project-auth-token=untrusted-carrier", "sb-project-auth-token.0=first; sb-project-auth-token.1=second"]) {
    const verified = runProxy({ path: "/client", cookies, user: true });
    assert.equal(verified.status, 200); assert.equal(verified.location, null); assert.equal(verified.next, "1"); assert.equal(verified.calls.user, 1);
  }
});

test("verified root redirect preserves refresh cookies and stays fixed same-origin and uncached", () => {
  const result = runProxy({ path: "/?next=https://unrelated.invalid", cookies: "sb-project-auth-token=old-synthetic-carrier", user: true, refresh: true });
  assert.equal(result.status, 307); assert.equal(result.location, "https://workstation.invalid/client"); assert.equal(result.cache, "private, no-store"); assert.equal(result.vary, "Cookie");
  assert.deepEqual(result.cookies, [{ name: "sb-project-auth-token", value: "synthetic-refreshed-carrier" }]); assert.equal(result.calls.user, 1);
});

test("POST/server actions, deeper private routes and APIs retain existing refresh and downstream guards", () => {
  for (const scenario of [{ path: "/client", method: "POST" }, { path: "/", method: "POST" }, { path: "/login", method: "POST" }, { path: "/start" }, { path: "/client/apps" }, { path: "/api/business/context" }, { path: "/unknown" }]) {
    const result = runProxy(scenario); assert.equal(result.status, 200); assert.equal(result.location, null); assert.equal(result.next, "1"); assert.deepEqual(result.calls, { env: 1, client: 1, user: 1 });
  }
  for (const path of ["/preview", "/preview/messages"]) assert.deepEqual(runProxy({ path, forbidEnv: true }).calls, { env: 0, client: 0, user: 0 });
  assert.equal(runProxy({ path: "/api/business/context", throwAuth: true }).threw, true);
});
