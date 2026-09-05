import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const ids = Object.fromEntries(
  [
    "partner",
    "client",
    "otherClient",
    "owner",
    "otherOwner",
    "flow",
    "binding",
    "approval",
  ].map((key) => [key, randomUUID()]),
);
function sql(source) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      "supabase_db_partner-platform",
      "psql",
      "-U",
      "supabase_admin",
      "-d",
      "beta_security_test",
      "-v",
      "ON_ERROR_STOP=1",
      "-Atq",
    ],
    { input: source, stdio: ["pipe", "pipe", "pipe"] },
  )
    .toString()
    .trim();
}
const asUser = (id, source) =>
  `begin; set local role authenticated; set local "request.jwt.claim.role"='authenticated'; set local "request.jwt.claim.sub"='${id}'; ${source} commit;`;
try {
  sql(`insert into auth.users(id,email) values('${ids.owner}','embedded-${ids.owner}@synthetic.invalid'),('${ids.otherOwner}','embedded-${ids.otherOwner}@synthetic.invalid');
 insert into public.partners(id,name,slug) values('${ids.partner}','Synthetic bridge partner','bridge-${ids.partner}');
 insert into public.client_businesses(id,partner_id,name,slug,client_portal_enabled) values('${ids.client}','${ids.partner}','Synthetic client','bridge-${ids.client}',true),('${ids.otherClient}','${ids.partner}','Sibling client','bridge-${ids.otherClient}',true);
 insert into public.memberships(user_id,partner_id,client_id,role) values('${ids.owner}','${ids.partner}','${ids.client}','client_owner'),('${ids.otherOwner}','${ids.partner}','${ids.otherClient}','client_owner');
 insert into public.embedded_connect_flows(id,partner_id,client_id,user_id,app_id,app_key,app_title) values('${ids.flow}','${ids.partner}','${ids.client}','${ids.owner}','test-app','test-key','Test app');`);
  const connection = sql(
    `select public.finish_embedded_connection('${ids.flow}','${ids.owner}','${ids.client}','synthetic-auth');`,
  );
  assert.throws(() =>
    sql(
      `select public.finish_embedded_connection('${ids.flow}','${ids.owner}','${ids.client}','synthetic-auth');`,
    ),
  );
  assert.equal(
    sql(
      asUser(
        ids.otherOwner,
        "select count(*) from public.embedded_app_connections;",
      ),
    ),
    "0",
  );
  assert.equal(
    sql(
      asUser(
        ids.owner,
        `select count(*) from public.embedded_app_connections where id='${connection}';`,
      ),
    ),
    "1",
  );
  assert.throws(() =>
    sql(
      asUser(
        ids.owner,
        `update public.embedded_app_connections set authentication_id='stolen' where id='${connection}';`,
      ),
    ),
  );
  assert.throws(() =>
    sql(
      asUser(
        ids.owner,
        `select public.finish_embedded_connection('${ids.flow}','${ids.owner}','${ids.client}','forged');`,
      ),
    ),
  );
  assert.throws(() =>
    sql(
      `insert into public.embedded_solution_bindings(partner_id,client_id,connection_id,direction,pack_key,event_type,action_key,action_title) values('${ids.partner}','${ids.otherClient}','${connection}','outbound','lead','lead.created','create','Create');`,
    ),
  );
  sql(`insert into public.embedded_solution_bindings(id,partner_id,client_id,connection_id,direction,pack_key,event_type,action_key,action_title) values('${ids.binding}','${ids.partner}','${ids.client}','${connection}','outbound','lead','lead.created','create','Create');
 insert into public.approval_items(id,partner_id,client_id,embedded_binding_id,type,title,proposed_payload) values('${ids.approval}','${ids.partner}','${ids.client}','${ids.binding}','external_action','Test app action','{"input":{"note":"Approved exact content"}}');`);
  assert.throws(() =>
    sql(
      asUser(
        ids.owner,
        `update public.approval_items set status='edited_and_approved',resolved_content='Changed',resolved_by='${ids.owner}' where id='${ids.approval}';`,
      ),
    ),
  );
  assert.equal(
    sql(
      asUser(
        ids.otherOwner,
        `update public.approval_items set status='approved',resolved_by='${ids.otherOwner}' where id='${ids.approval}' returning id;`,
      ),
    ),
    "",
  );
  sql(
    asUser(
      ids.owner,
      `update public.approval_items set status='approved',resolved_by='${ids.owner}' where id='${ids.approval}';`,
    ),
  );
  assert.equal(
    sql(
      `select count(*) from public.action_jobs where approval_id='${ids.approval}' and kind='external.action' and payload->'input'->>'note'='Approved exact content';`,
    ),
    "1",
  );
  assert.throws(() =>
    sql(
      asUser(
        ids.owner,
        `update public.approval_items set proposed_payload='{}' where id='${ids.approval}';`,
      ),
    ),
  );
  console.log(
    "PASS: embedded account ownership, single-use authorization sessions, sibling-client isolation, service-only writes/RPC, foreign-key scope, immutable external approval, and atomic outbox.",
  );
} finally {
  sql(
    `delete from public.action_jobs where client_id in ('${ids.client}','${ids.otherClient}'); delete from public.approval_items where client_id in ('${ids.client}','${ids.otherClient}'); delete from public.partners where id='${ids.partner}'; delete from auth.users where id in ('${ids.owner}','${ids.otherOwner}');`,
  );
}
