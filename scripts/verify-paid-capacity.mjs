import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

// Synthetic, concurrent paid-plan checks only in the disposable local schema.
const paid = randomUUID();
const manual = randomUUID();
const owner = randomUUID();
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
    insert into auth.users(id,email) values('${owner}','paid-capacity-${owner}@synthetic.invalid');
    insert into public.partners(id,name,slug) values
      ('${paid}','Synthetic paid partner','paid-${paid}'),('${manual}','Synthetic manual beta partner','manual-${manual}');
    insert into public.partner_enrollments(owner_id,agency_name,partner_id,status)
      values('${owner}','Synthetic paid agency','${paid}','pending');
    insert into public.memberships(user_id,partner_id,role) values('${owner}','${paid}','partner_owner');
    insert into public.client_businesses(partner_id,name,slug)
      select '${manual}','Manual client '||n,'manual-'||n from generate_series(1,12) n;
    insert into public.client_businesses(partner_id,name,slug,account_kind)
      values('${paid}','Internal agency workspace','agency','partner_agency');
    commit;`);
  assert.equal(await query(`select count(*) from public.client_businesses where partner_id='${manual}';`), "12", "Manual beta partner was unexpectedly capped");
  await query(`do $$ declare state text; blocked boolean; begin
    foreach state in array array['pending','past_due','cancelled'] loop
      update public.partner_enrollments set status=state where partner_id='${paid}';
      blocked:=false;
      begin insert into public.client_businesses(partner_id,name,slug) values('${paid}','Blocked client','blocked');
      exception when sqlstate 'P1001' then blocked:=true; end;
      if not blocked then raise exception 'Nonpaying enrollment created a client'; end if;
    end loop;
    update public.partner_enrollments set status='trialing' where partner_id='${paid}';
    insert into public.client_businesses(partner_id,name,slug) values('${paid}','Trial client','trial');
    update public.partner_enrollments set status='active' where partner_id='${paid}';
    insert into public.client_businesses(partner_id,name,slug)
      select '${paid}','Paid client '||n,'paid-'||n from generate_series(1,8) n;
    end $$;`);
  const create = () => query(`begin; set local role authenticated;
    set local "request.jwt.claim.role"='authenticated'; set local "request.jwt.claim.sub"='${owner}';
    insert into public.client_businesses(partner_id,name,slug)
      values('${paid}','Concurrent paid client','concurrent-${randomUUID()}') returning id;
    commit;`);
  const outcomes = await Promise.allSettled([create(), create()]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1, "Concurrent creates exceeded ten managed clients");
  const rejected = outcomes.find((result) => result.status === "rejected");
  assert.match(rejected.reason.message, /includes 10 client businesses/, "Concurrent create failed for a reason other than the paid cap");
  assert.equal(await query(`select count(*) from public.client_businesses where partner_id='${paid}' and account_kind='managed_client';`), "10");
  await query(`do $$ declare blocked boolean:=false; begin
    begin update public.client_businesses set partner_id='${paid}' where partner_id='${manual}' and slug='manual-1';
    exception when sqlstate 'P1002' then blocked:=true; end;
    if not blocked then raise exception 'Transfer bypassed the managed-client capacity limit'; end if;
    end $$;`);
  await query(`begin;
    update public.partner_enrollments set status='past_due' where partner_id='${paid}';
    set local role authenticated;
    set local "request.jwt.claim.role"='authenticated'; set local "request.jwt.claim.sub"='${owner}';
    update public.client_businesses set name='Existing workspace remains manageable' where partner_id='${paid}' and slug='trial';
    commit;`);
  assert.equal(await query(`select name from public.client_businesses where partner_id='${paid}' and slug='trial';`), "Existing workspace remains manageable");
  console.log("PASS: paid/trial enrollment required only for new managed clients, ten-client cap holds concurrently, agency workspace excluded, and manual beta/existing workspaces remain usable.");
} finally {
  await query(`begin;
    delete from public.partner_enrollments where owner_id='${owner}';
    delete from public.partners where id in ('${paid}','${manual}');
    delete from auth.users where id='${owner}';
    commit;`);
}
