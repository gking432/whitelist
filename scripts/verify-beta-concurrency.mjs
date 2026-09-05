import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

// Concurrent transactions require committed fixtures, exclusively in the
// disposable local schema. Unique synthetic rows are removed in finally.
const partner = randomUUID();
const client = randomUUID();
const owner = randomUUID();
const approval = randomUUID();
function query(sql) {
  return new Promise((resolve, reject) => {
    const process = spawn("docker", ["exec", "-i", "supabase_db_partner-platform", "psql",
      "-U", "supabase_admin", "-d", "beta_security_test", "-v", "ON_ERROR_STOP=1", "-Atq"]);
    let output = "";
    let error = "";
    process.stdout.on("data", (chunk) => { output += chunk; });
    process.stderr.on("data", (chunk) => { error += chunk; });
    process.on("error", reject);
    process.on("close", (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error)));
    process.stdin.end(sql);
  });
}
try {
  await query(`begin;
    insert into auth.users(id,email) values('${owner}','concurrency-${owner}@synthetic.invalid');
    insert into public.partners(id,name,slug) values('${partner}','Synthetic concurrency partner','concurrency-${partner}');
    insert into public.client_businesses(id,partner_id,name,slug,client_portal_enabled)
      values('${client}','${partner}','Synthetic concurrency business','concurrency-${client}',true);
    insert into public.memberships(user_id,partner_id,client_id,role) values('${owner}','${partner}','${client}','client_owner');
    insert into public.approval_items(id,partner_id,client_id,type,title,editable_content,proposed_payload)
      values('${approval}','${partner}','${client}','customer_message','Synthetic concurrency approval','Approved synthetic content','{"channel":"sms","to":"synthetic-recipient"}');
    commit;`);
  const resolveApproval = () => query(`begin; set local role authenticated;
    set local "request.jwt.claim.role"='authenticated'; set local "request.jwt.claim.sub"='${owner}';
    update public.approval_items set status='approved',resolved_by='${owner}' where id='${approval}' and status='pending' returning id;
    commit;`);
  const resolutions = await Promise.all([resolveApproval(), resolveApproval()]);
  assert.equal(resolutions.filter((value) => value === approval).length, 1, "Two resolvers acquired one pending approval");
  assert.equal(await query(`select count(*) from public.action_jobs where approval_id='${approval}';`), "1", "Resolution did not create exactly one durable action");
  const claim = () => query(`update public.action_jobs set status='processing',claim_token=extensions.gen_random_uuid(),claimed_at=now()
    where approval_id='${approval}' and status='pending' returning id;`);
  const claims = await Promise.all([claim(), claim()]);
  assert.equal(claims.filter(Boolean).length, 1, "Two workers acquired the same pending action");
  const reserve = () => query(`set role service_role;
    select public.reserve_ai_call('${partner}','${client}','concurrency','synthetic-model',repeat('a',64),4000,6000);`);
  const reservations = await Promise.all([reserve(), reserve()]);
  assert.equal(reservations.filter(Boolean).length, 1, "Concurrent AI reservations exceeded the daily limit");
  assert.equal(await query(`select committed_tokens from public.ai_daily_token_budgets where scope_key='client:${client}';`), "4000");
  console.log("PASS: concurrent human resolutions create one outbox, action claims have one owner, and AI reservations cannot overspend.");
} finally {
  await query(`begin;
    delete from public.ai_daily_token_budgets where scope_key='client:${client}';
    delete from public.partners where id='${partner}';
    delete from auth.users where id='${owner}';
    commit;`);
}
