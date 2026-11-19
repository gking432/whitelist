import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Scenario = {
  body?: unknown; rawBody?: string; origin?: string | null; id?: string; signedIn?: boolean; canResolve?: boolean;
  impersonationMode?: "sandbox_full" | "read_only"; accessError?: string; result?: unknown; resolverThrows?: string; contentLength?: string;
};
type Observation = { http: number; body: { status: string; httpStatus: number; message: string }; noStore: string; calls: { auth: number; rls: number; admin: number; resolve: number; scope?: string; actor?: string; clientKind?: string } };
const id = "11111111-1111-4111-8111-111111111111";

function route(scenario: Scenario): Observation {
  const source = `
    const Module=require("node:module"),original=Module._load,scenario=${JSON.stringify(scenario)};
    const calls={auth:0,rls:0,admin:0,resolve:0};
    const access={userId:"genuine-owner",role:"client_owner",clientId:"server-derived-client",canResolveApprovals:scenario.canResolve!==false,isImpersonating:!!scenario.impersonationMode,impersonationMode:scenario.impersonationMode};
    const mocks={
      "@/lib/env":{getAppUrl:()=>"http://127.0.0.1:3000"},
      "@/lib/auth/session":{getAuthState:async()=>{calls.auth++;return{user:scenario.signedIn===false?null:{id:"genuine-owner"}};}},
      "@/lib/permissions/access":{isAccessError:error=>!!error&&error.code==="ACCESS_DENIED",requirePrimaryClientAccess:async(user,roles)=>{if(user!=="genuine-owner"||!roles.includes("client_owner"))throw new Error("Wrong authenticated actor or roles");if(scenario.accessError)throw{code:scenario.accessError};return access;}},
      "@/lib/supabase/server":{createSupabaseServerClient:async()=>{calls.rls++;return{kind:"rls"};}},
      "@/lib/supabase/admin":{createSupabaseAdminClient:()=>{calls.admin++;return{kind:"sandbox"};}},
      "@/lib/approvals/resolve":{resolveApprovalItem:async input=>{calls.resolve++;calls.scope=input.clientId;calls.actor=input.access.userId;calls.clientKind=input.supabase.kind;if(scenario.resolverThrows)throw new SyntaxError("private post-commit diagnostic");return scenario.result||{status:"success",httpStatus:200,message:"Approval recorded."};}},
    };
    Module._load=function(name,...rest){return mocks[name]||original.call(this,name,...rest);};
    const {POST}=require("./app/api/business/approvals/[approvalId]/route.ts");Module._load=original;
    const request=new Request("http://127.0.0.1:3000/api/business/approvals/"+(scenario.id||${JSON.stringify(id)}),{method:"POST",headers:{...(scenario.origin===null?{}:{origin:scenario.origin||"http://127.0.0.1:3000"}),"content-type":"application/json",...(scenario.contentLength?{"content-length":scenario.contentLength}:{})},body:scenario.rawBody===undefined?JSON.stringify(scenario.body||{resolution:"approve"}):scenario.rawBody});
    POST(request,{params:Promise.resolve({approvalId:scenario.id||${JSON.stringify(id)}})}).then(async response=>{process.stdout.write(JSON.stringify({http:response.status,body:await response.json(),noStore:response.headers.get("cache-control"),calls}));}).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as Observation;
}

test("owner approval JSON uses fresh authentication, server scope and the user RLS client", () => {
  const result = route({}); assert.equal(result.http, 200); assert.equal(result.body.httpStatus, 200); assert.equal(result.body.status, "success");
  assert.equal(result.noStore, "no-store");
  assert.deepEqual(result.calls, { auth: 1, rls: 1, admin: 0, resolve: 1, scope: "server-derived-client", actor: "genuine-owner", clientKind: "rls" });
  const sandbox = route({ impersonationMode: "sandbox_full" }); assert.equal(sandbox.calls.clientKind, "sandbox"); assert.equal(sandbox.calls.admin, 1); assert.equal(sandbox.calls.rls, 0);
  const readOnly = route({ impersonationMode: "read_only", canResolve: false }); assert.equal(readOnly.http, 403); assert.equal(readOnly.calls.resolve, 0); assert.equal(readOnly.calls.admin, 0);
});

test("every resolver error status remains the actual HTTP status with no retry", () => {
  for (const httpStatus of [403, 404, 409, 422, 503]) {
    const result = route({ result: { status: "error", httpStatus, message: "Refresh and review this approval." } });
    assert.equal(result.http, httpStatus); assert.equal(result.body.httpStatus, httpStatus); assert.equal(result.body.status, "error"); assert.equal(result.calls.resolve, 1);
  }
});

test("approval route denies origin, malformedID, signed-out and denied-role requests", () => {
  for (const [scenario, status] of [[{ origin: "https://foreign.test" }, 403], [{ origin: null }, 403], [{ id: "not-an-id" }, 400], [{ signedIn: false }, 403], [{ accessError: "ACCESS_DENIED" }, 403], [{ canResolve: false }, 403]] as const) {
    const result = route(scenario); assert.equal(result.http, status); assert.equal(result.body.httpStatus, status); assert.equal(result.calls.resolve, 0);
  }
});

test("strict bounded approval JSON rejects scope injection and malformed or oversized bodies", () => {
  for (const field of ["actorId", "clientId", "partnerId", "unknown"]) {
    const result = route({ body: { resolution: "approve", [field]: id } }); assert.equal(result.http, 400); assert.equal(result.calls.resolve, 0);
  }
  for (const scenario of [{ rawBody: "not JSON" }, { body: { resolution: "unsupported" } }, { body: { resolution: "approve", note: "x".repeat(2001) } }]) assert.equal(route(scenario).http, 400);
  for (const scenario of [{ contentLength: "32769" }, { rawBody: " ".repeat(32769) }]) {
    const result = route(scenario); assert.equal(result.http, 413); assert.equal(result.calls.resolve, 0);
  }
});

test("an interrupted or malformed saved result stays uncertain503 without exposing internal diagnostics", () => {
  for (const scenario of [{ resolverThrows: "after-commit" }, { result: { status: "success" } }, { result: { status: "success", httpStatus: 409, message: "private invalid receipt" } }]) {
    const result = route(scenario); assert.equal(result.http, 503); assert.equal(result.calls.resolve, 1);
    assert.match(result.body.message, /check Action history before deciding again/); assert.doesNotMatch(result.body.message, /private/);
  }
});
