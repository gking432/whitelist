import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/env";
import { hasPossibleSessionCookie, hasPrivateSignInIntent, publicReviewDestination } from "@/lib/auth/public-review-entry";

function entryRedirect(request: NextRequest, destination: string, refreshed?: NextResponse) {
  const redirect = NextResponse.redirect(new URL(destination, request.url));
  refreshed?.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  redirect.headers.set("Cache-Control", "private, no-store");
  redirect.headers.set("Vary", "Cookie");
  return redirect;
}

export async function proxy(request: NextRequest) {
  // Public design pages contain only empty, read-only UI state. Their rendering
  // must not depend on a business session or database availability.
  if (
    request.nextUrl.pathname === "/preview" ||
    request.nextUrl.pathname.startsWith("/preview/")
  ) {
    return NextResponse.next();
  }
  // Navigation only: POST/server actions retain their own Auth and mutation
  // guards. These exact public entries require no configured data service.
  const navigation = request.method === "GET" || request.method === "HEAD";
  const destination = navigation ? publicReviewDestination(request.nextUrl.pathname) : null;
  const privateSignIn = request.nextUrl.pathname === "/login" && hasPrivateSignInIntent({
    next: request.nextUrl.searchParams.get("next") ?? undefined,
    error: request.nextUrl.searchParams.get("error") ?? undefined,
    agency: request.nextUrl.searchParams.get("agency") ?? undefined,
  });
  const reviewEntry = destination !== null && !privateSignIn;
  if (reviewEntry && (request.nextUrl.pathname === "/login" ||
      !hasPossibleSessionCookie(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL))) {
    return entryRedirect(request, destination);
  }
  let response = NextResponse.next({
    request,
  });
  const env = getSupabasePublicEnv();

  if (!env) {
    return reviewEntry ? entryRedirect(request, destination) : response;
  }

  try {
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

    const { data, error } = await supabase.auth.getUser();
    if (reviewEntry) {
      if (error || !data.user) return entryRedirect(request, destination, response);
      if (request.nextUrl.pathname === "/") return entryRedirect(request, "/client", response);
      // A verified user may continue to /client; its existing loaders still
      // verify the actual session, business membership and permissions.
    }
  } catch (error) {
    if (reviewEntry) return entryRedirect(request, destination, response);
    throw error;
  }

  return response;
}

export const config = {
  // Webhook intake authenticates with per-connection credentials, not user
  // sessions, so it is excluded from the session-refresh middleware.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/integrations|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
