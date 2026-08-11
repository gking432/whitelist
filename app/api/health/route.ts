import { NextResponse } from "next/server";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json(
      { ok: false, checks: { database: "not_configured" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const startedAt = Date.now();
  const { error } = await admin
    .from("integration_providers")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  return NextResponse.json(
    {
      ok: !error,
      checks: { database: error ? "unavailable" : "ready" },
      latency_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    {
      status: error ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
