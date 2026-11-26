import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getSupabasePublicEnv } from "@/lib/env";
import { hasPossibleSessionCookie, hasPrivateSignInIntent, publicReviewDestination } from "@/lib/auth/public-review-entry";
import { createSupabaseAuthCookieAdapter, normalizeSupabaseAuthCookies, supabaseAuthFetch, type AuthCookieWrite } from "@/lib/supabase/auth-cookie-safety";

function entryRedirect(request: NextRequest, destination: string, refreshed?: NextResponse) {
  const redirect = NextResponse.redirect(new URL(destination, request.url));
  refreshed?.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  redirect.headers.set("Cache-Control", "private, no-store");
  redirect.headers.set("Vary", "Cookie");
  return redirect;
}

export async function proxy(request: NextRequest) {
  // These bounded handlers verify their own PKCE/session continuity. Never
  // refresh or persist an identity-provider response through generic proxy Auth.
  if (request.nextUrl.pathname === "/auth/google/start" || request.nextUrl.pathname === "/auth/google/callback") return NextResponse.next();
  // Storage hygiene uses only the configured project URL. It makes no Auth or
  // database call, and runs before any optimistic public-entry cookie hint.
  let publicHygiene: AuthCookieWrite[] = [];
  const publicPath = request.nextUrl.pathname === "/start" || request.nextUrl.pathname === "/preview" || request.nextUrl.pathname.startsWith("/preview/") || publicReviewDestination(request.nextUrl.pathname) !== null;
  if (publicPath && process.env.NEXT_PUBLIC_SUPABASE_URL) {
    try { publicHygiene = normalizeSupabaseAuthCookies(process.env.NEXT_PUBLIC_SUPABASE_URL, request.cookies.getAll()).updates; } catch { /* An invalid project URL cannot authorize any user. */ }
    for (const cookie of publicHygiene) { if (!cookie.value || cookie.options.maxAge === 0) request.cookies.delete(cookie.name); else request.cookies.set(cookie.name, cookie.value); }
  }
  const finishPublic = (response: NextResponse) => { for (const cookie of publicHygiene) response.cookies.set(cookie.name, cookie.value, cookie.options); return response; };
  // Public design pages contain only empty, read-only UI state. Their rendering
  // must not depend on a business session or database availability.
  if (
    request.nextUrl.pathname === "/preview" ||
    request.nextUrl.pathname.startsWith("/preview/")
  ) {
    return finishPublic(NextResponse.next({ request }));
  }
  // Navigation only: POST/server actions retain their own Auth and mutation
  // guards. These exact public entries require no configured data service.
  const navigation = request.method === "GET" || request.method === "HEAD";
  const publicQuestions = navigation && request.nextUrl.pathname === "/start";
  if (publicQuestions && !hasPossibleSessionCookie(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL)) return finishPublic(NextResponse.next({ request }));
  const destination = navigation ? publicReviewDestination(request.nextUrl.pathname) : null;
  const privateSignIn = request.nextUrl.pathname === "/login" && hasPrivateSignInIntent({
    next: request.nextUrl.searchParams.get("next") ?? undefined,
    error: request.nextUrl.searchParams.get("error") ?? undefined,
    agency: request.nextUrl.searchParams.get("agency") ?? undefined,
  });
  const reviewEntry = destination !== null && !privateSignIn;
  if (reviewEntry && (request.nextUrl.pathname === "/login" ||
      !hasPossibleSessionCookie(request.cookies.getAll(), process.env.NEXT_PUBLIC_SUPABASE_URL))) {
    return finishPublic(entryRedirect(request, destination));
  }
  let response = finishPublic(NextResponse.next({
    request,
  }));
  const env = getSupabasePublicEnv();

  if (!env) {
    return reviewEntry ? entryRedirect(request, destination, response) : response;
  }

  try {
    const pendingCookies = new Map<string, AuthCookieWrite>(publicHygiene.map(cookie => [cookie.name, cookie]));
    const safeCookies = createSupabaseAuthCookieAdapter(env.url, {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          if (!value || options.maxAge === 0) request.cookies.delete(name);
          else request.cookies.set(name, value);
        });
        cookiesToSet.forEach(cookie => pendingCookies.set(cookie.name, cookie));

        response = NextResponse.next({
          request,
        });

        pendingCookies.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    });
    const supabase = createServerClient(env.url, env.anonKey, {
      global: { fetch: supabaseAuthFetch(env.url) },
      cookies: safeCookies,
    });

    const { data, error } = await supabase.auth.getUser();
    if (reviewEntry) {
      if (error || !data.user) return entryRedirect(request, destination, response);
      if (request.nextUrl.pathname === "/") return entryRedirect(request, "/client", response);
      // A verified user may continue to /client; its existing loaders still
      // verify the actual session, business membership and permissions.
    }
  } catch (error) {
    if (publicQuestions) return response;
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
