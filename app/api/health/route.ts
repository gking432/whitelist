import { NextResponse } from "next/server";

import { productionReadiness } from "@/lib/ops/production-readiness";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const readiness = productionReadiness();
  const configurationReady = !readiness.enforced || readiness.ready;

  if (!admin) {
    return NextResponse.json(
      {
        ok: false,
        checks: {
          database: "not_configured",
          configuration: configurationReady ? "ready" : "incomplete",
        },
        configuration_issue_count: readiness.enforced
          ? readiness.issues.length
          : 0,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();
  const { error } = await admin
    .from("integration_providers")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  const ok = !error && configurationReady;

  return NextResponse.json(
    {
      ok,
      checks: {
        database: error ? "unavailable" : "ready",
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
    },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
