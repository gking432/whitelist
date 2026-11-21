// Source-contract tests only; real PostgreSQL/HTTP execution is required in CI.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const migrationName = "20261121205414_oauth_conflict_transport.sql";
const migrations = new URL("../supabase/migrations/", import.meta.url);
const migration = await readFile(new URL(migrationName, migrations), "utf8");
const asset = await readFile(new URL("../scripts/sql/oauth-conflict-acceptance.sql", import.meta.url), "utf8");
const names = [
  ["finish_readonly_workspace_oauth", 2],
  ["finish_google_permission_upgrade", 3],
  ["begin_hubspot_oauth", 1],
  ["finish_hubspot_oauth", 2],
] as const;
function extract(source: string, name: string): string | undefined {
  return source.match(new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?end \\$\\$;`, "i"))?.[0];
}
const files = (await readdir(migrations)).filter((name) => name < migrationName && name.endsWith(".sql")).sort();
for (const [name, count] of names) {
  test(`${name} preserves the latest full definition except deliberate conflict literals`, async () => {
    let effective: string | undefined;
    for (const file of files) {
      const found = extract(await readFile(new URL(file, migrations), "utf8"), name);
      if (found) effective = found;
    }
    assert.ok(effective, `Missing prior effective ${name}`);
    assert.equal(effective.match(/errcode='40001'/g)?.length, count);
    const expected = effective.replace(/^create(?: or replace)? function/i, "create or replace function").replaceAll("errcode='40001'", "errcode='PT409'");
    assert.equal(extract(migration, name), expected);
    const body = expected.split("as $$")[1].split("$$;")[0];
    const hash = createHash("md5").update(body).digest("hex");
    assert.ok(asset.includes(`'${hash}',${count})`), "Actual catalog must compare the entire unchanged body");
  });
}
test("the migration adds only four invoker replacements and no exception handler or privilege change", () => {
  assert.equal((migration.match(/create or replace function public\./g) ?? []).length, 4);
  assert.equal((migration.match(/errcode='PT409'/g) ?? []).length, 8);
  assert.equal((migration.match(/security invoker set search_path='' as/g) ?? []).length, 4);
  const code = migration.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(exception when|security definer|grant |revoke |create table|alter table|drop function)\b/i);
  assert.doesNotMatch(code, /errcode='40001'|40P01|serialization_failure|deadlock_detected/);
});
test("the disposable acceptance retains strict replay, validation, ACL, catalog and no-effect checks", () => {
  assert.match(asset, /^-- Disposable real-Postgres/);
  assert.match(asset, /current_database\(\) !~ '_\(test\|acceptance\)\$'/);
  assert.match(asset, /pg_advisory_xact_lock\(1937402189\)/);
  assert.equal((asset.match(/-- Group[1-8]:/g) ?? []).length, 8);
  assert.match(asset, /oc_expect\(command,'P0002'\)/);
  assert.match(asset, /then '22023' else 'PT409'/);
  assert.match(asset, /scopes text\[\]:=array\['https:\/\/www\.googleapis\.com\/auth\/gmail\.readonly','https:\/\/www\.googleapis\.com\/auth\/calendar\.events','https:\/\/www\.googleapis\.com\/auth\/calendar\.calendarlist\.readonly'\]/);
  assert.match(asset, /then 'PT409' else 'P0001'/);
  assert.match(asset, /before_state is distinct from pg_temp\.oc_state\(\)/);
  for (const key of ["signature", "owner", "securityDefiner", "configuration", "publicExecute", "anonExecute", "authenticatedExecute", "serviceExecute", "bodyHash"]) assert.ok(asset.includes(`'${key}'`));
  assert.match(asset, /rollback;\nselect '__CUSTOMER_JOURNEY_REPORT__'::text/);
  assert.doesNotMatch(asset, /disable trigger|disable row level security|session_replication_role/i);
});
test("existing assets update only the selected OAuth callback expectations", async () => {
  const google = await readFile(new URL("../scripts/sql/google-calendar-acceptance.sql", import.meta.url), "utf8");
  const hubspot = await readFile(new URL("../scripts/sql/hubspot-oauth-acceptance.sql", import.meta.url), "utf8");
  assert.match(google, /finish_google_permission_upgrade\([^\n]+exception when sqlstate 'PT409'/);
  assert.match(google, /finish_readonly_workspace_oauth\([^\n]+\n exception when sqlstate 'PT409'/);
  assert.match(google, /reconcile_calendar_change\([^\n]+exception when sqlstate '40001'/);
  assert.match(hubspot, /hf_finish\(aid,[\s\S]*?exception when sqlstate 'PT409' then denied:=true; end;/);
  assert.match(hubspot, /configure_hubspot\([^\n]+exception when sqlstate '40001'/);
});
