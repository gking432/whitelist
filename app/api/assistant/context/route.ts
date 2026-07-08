import { NextResponse, type NextRequest } from "next/server";

import { resolveAssistantAccess } from "@/lib/assistant/access";
import { buildAssistantContext } from "@/lib/assistant/context";
import { getAuthState } from "@/lib/auth/session";
import type { ClientBusinessRecord } from "@/lib/clients/constants";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Assistant Context API (docs/18): the same AssistantContextData the web
// consoles render, served as JSON for future runtimes — desktop tray app,
// browser extension, CRM overlay. Authentication is the app session
// (Supabase auth cookies); tenancy is enforced the same way as the web
// surfaces:
//   - partner members pass ?client_id= for a client in their partner org
//   - client members omit client_id and get their own business
// GET /api/assistant/context[?client_id=<uuid>]

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  const authState = await getAuthState();

  if (!authState.user) {
    return json(401, { error: "Sign in to read the assistant context." });
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return json(503, { error: "The data service is unavailable." });
  }

  const requestedClientId = request.nextUrl.searchParams.get("client_id");
  let clientId: string | null = requestedClientId;
  let audience: "partner" | "client" = "partner";

  try {
    if (clientId) {
      // Explicit client: allowed for partner members of that client's
      // partner org, or the client's own members.
      const access = await resolveAssistantAccess(
        authState.user.id,
        clientId,
        "read",
      );

      audience = access.clientId ? "client" : "partner";
    } else {
      // No client specified: resolve the caller's own client membership.
      const access = await requirePrimaryClientAccess(authState.user.id);
      clientId = access.clientId ?? null;
      audience = "client";
    }
  } catch (error) {
    if (isAccessError(error)) {
      return json(
        error.code === "ACCESS_DENIED" ? 404 : 503,
        {
          error:
            error.code === "ACCESS_DENIED"
              ? "Client not found or inaccessible."
              : "Access checks are unavailable right now.",
        },
      );
    }

    throw error;
  }

  if (!clientId) {
    return json(404, { error: "Client not found or inaccessible." });
  }

  const { data: client } = await supabase
    .from("client_businesses")
    .select("*")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    return json(404, { error: "Client not found or inaccessible." });
  }

  const context = await buildAssistantContext(
    supabase,
    client as ClientBusinessRecord,
    { audience },
  );

  return json(200, {
    generated_at: new Date().toISOString(),
    context,
  });
}
