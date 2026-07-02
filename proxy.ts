import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/env";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });
  const env = getSupabasePublicEnv();

  if (!env) {
    return response;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({
          request,
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  // Webhook intake authenticates with per-connection credentials, not user
  // sessions, so it is excluded from the session-refresh middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/integrations|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
