import { NextResponse } from "next/server";

import { productionReadiness } from "@/lib/ops/production-readiness";
import { releaseId } from "@/lib/ops/release-id";
import {
  EXPECTED_SCHEMA_VERSION,
  schemaVersionIsCompatible,
} from "@/lib/ops/schema-version";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const readiness = productionReadiness();
  const configurationReady = !readiness.enforced || readiness.ready;
  const release = releaseId();

  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        checks: {
          database: "not_configured",
          database_schema: "unavailable",
          configuration: configurationReady ? "ready" : "incomplete",
        },
        configuration_issue_count: readiness.enforced
          ? readiness.issues.length
          : 0,
        release,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();
  const [{ error }, { data: schemaState, error: schemaError }] = await Promise.all([
    admin
      .from("integration_providers")
      .select("id", { head: true, count: "exact" })
      .limit(1),
    admin
      .from("platform_schema_state")
      .select("current_migration")
      .eq("singleton", true)
      .maybeSingle(),
  ]);
  const schemaReady =
    !schemaError &&
    schemaVersionIsCompatible(
      schemaState?.current_migration,
      EXPECTED_SCHEMA_VERSION,
    );

  const ok = !error && schemaReady && configurationReady;

  return NextResponse.json(
    {
      ok,
      checks: {
        database: error ? "unavailable" : "ready",
        database_schema: schemaReady ? "ready" : "outdated",
        configuration: readiness.enforced
          ? readiness.ready
            ? "ready"
            : "incomplete"
          : "not_enforced",
      },
      configuration_issue_count: readiness.enforced
        ? readiness.issues.length
        : 0,
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
      release,
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
