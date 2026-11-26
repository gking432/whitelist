import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import type { ContextDiagnostic } from "../lib/auth/context-diagnostics.ts";

type Scenario = {
  fault?: "membership_error" | "membership_missing" | "membership_no_client" | "scope_error" | "scope_missing" | "portal_disabled" | "portal_error" | "portal_missing" | "branding_error" | "membership_throw" | "scope_throw" | "portal_throw";
  noClientAt?: number; observerThrows?: boolean; legacy?: boolean; direct?: boolean; roles?: string[]; errorCode?: string;
};
type Observation = {
  kind?: string; role?: string; brandingFallback?: boolean; thrown?: { code?: string; status?: number; original: boolean };
  events: ContextDiagnostic[]; calls: { client: number; auth: { path: string; observerPassed: boolean }[]; queries: { table: string; columns: string; filters: unknown[][] }[] };
};

/** Execute the real portal and permission modules; replace only external
 * clients/Auth/impersonation dependencies. No application query reaches a DB. */
function exercise(scenario: Scenario = {}): Observation {
  const program = `
    const Module=require('node:module'), original=Module._load, scenario=${JSON.stringify(scenario)};
    const calls={client:0,auth:[],queries:[]},events=[];
    const privateError=Object.assign(new Error('TOKEN-SECRET COOKIE-SECRET ROW-SECRET'),{code:scenario.errorCode||'PGRST002',status:503,details:'ROW-SECRET',hint:'COOKIE-SECRET'});
    const actor={id:'actor-row'},membership={id:'membership-row',user_id:actor.id,partner_id:'partner-row',client_id:'client-row',role:scenario.roles?.[0]||'client_owner',status:'active',client_job_role:null,client_permissions:null};
    const business={id:'client-row',partner_id:'partner-row',client_portal_enabled:scenario.fault!=='portal_disabled',partner_can_edit_client_data:false,account_kind:'managed_client',is_test_account:false,private:'ROW-SECRET'};
    const observer=event=>{events.push(event);if(scenario.observerThrows)throw privateError;};
    function from(table){
      const query={table,columns:'',filters:[]}; calls.queries.push(query);
      const builder={select(columns){query.columns=columns;return builder;},eq(...args){query.filters.push(['eq',...args]);return builder;},not(...args){query.filters.push(['not',...args]);return builder;},in(...args){query.filters.push(['in',...args]);return builder;},order(...args){query.filters.push(['order',...args]);return builder;},limit(...args){query.filters.push(['limit',...args]);return builder;},async maybeSingle(){
        const stage=table==='memberships'?'membership':table==='client_businesses'?(query.columns==='*'?'portal':'scope'):'branding';
        if(scenario.fault===stage+'_throw')throw privateError;
        if(scenario.fault===stage+'_error')return{data:null,error:privateError,status:503};
        if(scenario.fault===stage+'_missing')return{data:null,error:null,status:200};
        if(stage==='membership')return{data:{...membership,...(scenario.fault==='membership_no_client'?{client_id:null}:{})},error:null,status:200};
        if(stage==='scope'||stage==='portal')return{data:business,error:null,status:200};
        return{data:null,error:null,status:200};
      }};return builder;
    }
    const mocks={
      '@/lib/auth/session':{requireAuthenticatedUser:async(path,observed)=>{calls.auth.push({path,observerPassed:observed===observer});return actor;}},
      '@/lib/supabase/server':{createSupabaseServerClient:async()=>{calls.client++;return scenario.noClientAt===calls.client?null:{from};}},
      '@/lib/impersonation/session':{getActiveImpersonation:async()=>null},
    };
    Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args);};
    const {loadClientPortal}=require('./lib/clients/portal.ts');
    const {requirePrimaryClientAccess}=require('./lib/permissions/access.ts');Module._load=original;
    (async()=>{
      let result;
      try{
        const observed=scenario.legacy?undefined:observer;
        const value=scenario.direct?await requirePrimaryClientAccess(actor.id,scenario.roles,observed):scenario.legacy?await loadClientPortal():await loadClientPortal(observed);
        result=scenario.direct?{role:value.role}:{kind:value.kind,...(value.kind==='ok'?{role:value.access.role,brandingFallback:value.branding.partnerName==='Your service partner'&&value.branding.productName==='Your service partner CRM'}:{})};
      }catch(error){result={thrown:{code:error.code,status:error.status,original:error===privateError}};}
      process.stdout.write(JSON.stringify({...result,events,calls}));
    })().catch(()=>{process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as Observation;
}

test("the actual portal passes the observer through Auth and primary access without changing successful queries or branding fallbacks", () => {
  const observed = exercise(), legacy = exercise({ legacy: true });
  assert.equal(observed.kind, "ok"); assert.equal(observed.role, "client_owner"); assert.equal(observed.brandingFallback, true);
  assert.deepEqual(observed.events, []); assert.deepEqual(legacy.events, []);
  assert.deepEqual(observed.calls.auth, [{ path: "/client", observerPassed: true }]);
  assert.deepEqual(legacy.calls.auth, [{ path: "/client", observerPassed: false }]);
  assert.equal(observed.calls.client, 3); assert.deepEqual(observed.calls.queries, legacy.calls.queries);
  assert.deepEqual(observed.calls.queries.map((query) => query.table), ["memberships", "client_businesses", "client_businesses", "partners", "partner_branding"]);
  assert.deepEqual(observed.calls.queries[0].filters, [["eq", "user_id", "actor-row"], ["eq", "status", "active"], ["not", "client_id", "is", null], ["in", "role", ["client_owner", "client_manager", "client_staff", "client_viewer"]], ["order", "created_at", { ascending: true }], ["limit", 1]]);
  assert.deepEqual(observed.calls.queries[1].filters, [["eq", "id", "client-row"]]);
  assert.deepEqual(observed.calls.queries[2].filters, [["eq", "id", "client-row"]]);
});

test("actual primary membership and client-scope backend failures are unavailable with original stage/status and no retry", () => {
  for (const [fault, stage, queries] of [["membership_error", "primary_membership", 1], ["scope_error", "client_scope", 2]] as const) {
    const result = exercise({ fault }); assert.equal(result.kind, "unavailable"); assert.equal(result.calls.queries.length, queries);
    assert.deepEqual(result.events[0], { stage, kind: "unavailable", status: 503, code: "PGRST002" });
    assert.equal(result.events.at(-1)?.stage, "portal_access");
  }
});

test("missing membership, missing client scope and a disabled portal remain denied and stop before private portal reads", () => {
  for (const [fault, stage, queries] of [["membership_missing", "primary_membership", 1], ["membership_no_client", "primary_membership", 1], ["scope_missing", "client_scope", 2], ["portal_disabled", "client_scope", 2]] as const) {
    const result = exercise({ fault }); assert.equal(result.kind, "denied"); assert.equal(result.calls.queries.length, queries);
    assert.equal(result.events[0].stage, stage); assert.equal(result.events[0].kind, "denied");
  }
});

test("portal client errors and absence preserve the unavailable return while identifying the actual failed read", () => {
  for (const fault of ["portal_error", "portal_missing"] as const) {
    const result = exercise({ fault }); assert.equal(result.kind, "unavailable"); assert.equal(result.calls.queries.length, 5);
    assert.deepEqual(result.events, [{ stage: "portal_client", kind: fault === "portal_error" ? "unavailable" : "denied", status: fault === "portal_error" ? 503 : 200, code: fault === "portal_error" ? "PGRST002" : null }]);
  }
  const optional = exercise({ fault: "branding_error" }); assert.equal(optional.kind, "ok"); assert.equal(optional.brandingFallback, true); assert.deepEqual(optional.events, []);
});

test("missing clients stay unavailable, preserve original query counts and emit configuration instead of a fabricated access decision", () => {
  for (const [noClientAt, queryCount] of [[1, 0], [2, 1], [3, 2]]) {
    const result = exercise({ noClientAt }); assert.equal(result.kind, "unavailable"); assert.equal(result.calls.client, noClientAt); assert.equal(result.calls.queries.length, queryCount);
    assert.deepEqual(result.events[0], { stage: "configuration", kind: "unavailable", status: null, code: null });
  }
});

test("observer exceptions and private backend data never change real return kinds, exceptions or sanitized event fields", () => {
  for (const fault of ["membership_error", "scope_error", "portal_error", "membership_missing", "portal_missing"] as const) {
    const baseline = exercise({ fault }), throwing = exercise({ fault, observerThrows: true });
    assert.deepEqual(throwing, baseline);
    assert.doesNotMatch(JSON.stringify(throwing.events), /TOKEN-SECRET|COOKIE-SECRET|ROW-SECRET|actor-row|client-row|partner-row|message|details|hint/);
    assert.ok(throwing.events.every((event) => Object.keys(event).sort().join(",") === "code,kind,stage,status"));
  }
  const unknownCode = exercise({ fault: "scope_error", errorCode: "TOKEN-SECRET" }); assert.equal(unknownCode.events[0].code, null);
});

test("rejected backend promises retain the exact original exception and query stage without retries", () => {
  for (const [fault, stage, queries] of [["membership_throw", "primary_membership", 1], ["scope_throw", "client_scope", 2], ["portal_throw", "portal_client", 5]] as const) {
    const result = exercise({ fault, observerThrows: true }); assert.deepEqual(result.thrown, { code: "PGRST002", status: 503, original: true });
    assert.deepEqual(result.events, [{ stage, kind: "unavailable", status: 503, code: "PGRST002" }]); assert.equal(result.calls.queries.length, queries);
  }
});

test("direct primary access keeps explicit role filters and legacy thrown error classifications", () => {
  const result = exercise({ direct: true, roles: ["client_viewer"] }); assert.equal(result.role, "client_viewer");
  assert.deepEqual(result.calls.queries[0].filters.find(([operation]) => operation === "in"), ["in", "role", ["client_viewer"]]);
  for (const [fault, code] of [["membership_error", "ACCESS_LOOKUP_FAILED"], ["scope_error", "ACCESS_LOOKUP_FAILED"], ["membership_missing", "ACCESS_DENIED"], ["portal_disabled", "ACCESS_DENIED"]] as const) {
    const observed = exercise({ direct: true, fault }), legacy = exercise({ direct: true, fault, legacy: true });
    assert.equal(observed.thrown?.code, code); assert.deepEqual(observed.thrown, legacy.thrown); assert.deepEqual(observed.calls, legacy.calls); assert.deepEqual(legacy.events, []);
  }
});
