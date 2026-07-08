import { NextResponse, type NextRequest } from "next/server";

import { resolveAssistantAccess } from "@/lib/assistant/access";
import { getAuthState } from "@/lib/auth/session";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Live assistant events, polling flavor (docs/18). Future runtimes poll
// this with ?after=<iso> until the SSE/WebSocket channel ships.
// GET /api/assistant/events[?client_id=<uuid>][&after=<iso8601>]

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: NextRequest) {
  const authState = await getAuthState();

  if (!authState.user) {
    return json(401, { error: "Sign in to read assistant events." });
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return json(503, { error: "The data service is unavailable." });
  }

  let clientId = request.nextUrl.searchParams.get("client_id");
  const after = request.nextUrl.searchParams.get("after");

  try {
    if (clientId) {
      await resolveAssistantAccess(authState.user.id, clientId, "read");
    } else {
      const access = await requirePrimaryClientAccess(authState.user.id);
      clientId = access.clientId ?? null;
    }
  } catch (error) {
    if (isAccessError(error)) {
      return json(error.code === "ACCESS_DENIED" ? 404 : 503, {
        error:
          error.code === "ACCESS_DENIED"
            ? "Client not found or inaccessible."
            : "Access checks are unavailable right now.",
      });
    }

    throw error;
  }

  if (!clientId) {
    return json(404, { error: "Client not found or inaccessible." });
  }

  let query = supabase
    .from("assistant_events")
    .select(
      "id, event_type, payload, workflow_run_id, approval_id, call_session_id, created_at",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (after && !Number.isNaN(Date.parse(after))) {
    query = query.gt("created_at", after);
  }

  const { data, error } = await query;

  if (error) {
    return json(500, { error: "Assistant events could not be loaded." });
  }

  return json(200, {
    generated_at: new Date().toISOString(),
    events: data ?? [],
  });
}
