import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type DatabaseFailure = { code: string; message: string };
type ApprovalScenario = {
  updateError?: DatabaseFailure;
  readError?: DatabaseFailure;
  missing?: boolean;
  status?: string;
  canResolve?: boolean;
  role?: string;
  assignedTo?: string;
  resolution?: string;
  type?: string;
};
type ApprovalObservation = {
  result: { status: string; httpStatus: number; message: string };
  reads: number;
  writes: number;
  network: number;
  filters: [string, unknown][];
};

// Execute the actual shared resolver through the installed TS/alias loader.
// Every tested path ends before delivery/audit, and any network I/O fails closed.
function resolveScenario(scenario: ApprovalScenario): ApprovalObservation {
  const source = `
    const assert=require("node:assert/strict");
    const scenario=${JSON.stringify(scenario)};
    const observation={reads:0,writes:0,network:0,filters:[]};
    global.fetch=async()=>{observation.network++;throw new Error("Unexpected network effect");};
    const {resolveApprovalItem}=require("./lib/approvals/resolve.ts");
    const row={id:"approval",partner_id:"partner",client_id:"client",workflow_run_id:null,type:scenario.type||"content_draft",status:scenario.status||"pending",title:"Owner decision",editable_content:"Reviewed content",proposed_payload:{},assigned_to:scenario.assignedTo||"owner"};
    let updating=false;
    const builder={select(){return builder;},eq(key,value){observation.filters.push([key,value]);return builder;},update(){observation.writes++;updating=true;return builder;},async maybeSingle(){
      if(updating)return {data:null,error:scenario.updateError||null};
      observation.reads++;return {data:scenario.missing?null:row,error:scenario.readError||null};
    }};
    const supabase={from(table){assert.equal(table,"approval_items");return builder;}};
    const access={userId:"owner",role:scenario.role||"client_owner",canResolveApprovals:scenario.canResolve!==false};
    resolveApprovalItem({supabase,access,approvalId:"approval",clientId:"client",resolution:scenario.resolution||"approve",editedContent:"Owner edited content"})
      .then(result=>process.stdout.write(JSON.stringify({...observation,result})))
      .catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], {
    encoding: "utf8", timeout: 15000, maxBuffer: 100000,
  })) as ApprovalObservation;
}

test("the shared approval resolver returns a structured nonretryable conflict without effects", () => {
  for (const code of ["PT409"]) {
    const observation = resolveScenario({ updateError: { code, message: "private source, recipient and authority detail" } });
    assert.equal(observation.result.status, "error"); assert.equal(observation.result.httpStatus, 409);
    assert.match(observation.result.message, /Refresh and review/);
    assert.doesNotMatch(observation.result.message, /private source|recipient|authority detail/);
    assert.equal(observation.reads, 1); assert.equal(observation.writes, 1); assert.equal(observation.network, 0);
    assert.ok(observation.filters.some(([key, value]) => key === "client_id" && value === "client"));
    assert.ok(observation.filters.some(([key, value]) => key === "status" && value === "pending"));
  }
});

test("approval deadlocks and unknown failures remain service errors without message guessing or retry", () => {
  for (const code of ["40001", "40P01", "XX000", "P0001"]) {
    const observation = resolveScenario({ updateError: { code, message: "source changed; request key reused; private detail" } });
    assert.equal(observation.result.status, "error"); assert.equal(observation.result.httpStatus, 503);
    assert.doesNotMatch(observation.result.message, /source changed|request key reused|private detail/);
    assert.equal(observation.writes, 1); assert.equal(observation.network, 0);
  }
});

test("already resolved and losing conditional pending updates are conflicts without subsequent effects", () => {
  const prior = resolveScenario({ status: "approved" });
  assert.equal(prior.result.httpStatus, 409); assert.equal(prior.writes, 0); assert.equal(prior.network, 0);
  const lost = resolveScenario({});
  assert.equal(lost.result.httpStatus, 409); assert.equal(lost.writes, 1); assert.equal(lost.network, 0);
  assert.match(lost.result.message, /changed or was already resolved/);
});

test("approval role, assignment and immutable-edit controls remain enforced before any update", () => {
  for (const [scenario, status] of [
    [{ canResolve: false }, 403],
    [{ role: "client_staff", assignedTo: "different-owner" }, 403],
    [{ type: "appointment_change", resolution: "edit_and_approve" }, 422],
    [{ type: "crm_change", resolution: "edit_and_approve" }, 422],
  ] as const) {
    const observation = resolveScenario(scenario);
    assert.equal(observation.result.httpStatus, status); assert.equal(observation.writes, 0); assert.equal(observation.network, 0);
  }
  assert.equal(resolveScenario({ canResolve: false }).reads, 0);
});

test("approval permission and read failures return safe structured status without false success", () => {
  assert.equal(resolveScenario({ updateError: { code: "42501", message: "private policy detail" } }).result.httpStatus, 403);
  assert.equal(resolveScenario({ updateError: { code: "22023", message: "private source validation detail" } }).result.httpStatus, 422);
  assert.equal(resolveScenario({ readError: { code: "40P01", message: "private deadlock detail" } }).result.httpStatus, 503);
  assert.equal(resolveScenario({ missing: true }).result.httpStatus, 404);
});
