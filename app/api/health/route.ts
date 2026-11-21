import { NextResponse } from "next/server";

import { loadPlatformHealth } from "@/lib/ops/platform-health";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = createSupabaseAdminClient();
  const health = await loadPlatformHealth(admin);

  return NextResponse.json(
    health,
    {
      status: health.ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
