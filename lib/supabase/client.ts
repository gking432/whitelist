"use client";

import { createBrowserClient, parseCookieHeader, serializeCookieHeader } from "@supabase/ssr";

import { requireSupabasePublicEnv } from "@/lib/env";
import { createSupabaseAuthCookieAdapter, supabaseAuthFetch } from "./auth-cookie-safety";

export function createSupabaseBrowserClient() {
  const env = requireSupabasePublicEnv();

  const safeCookies = createSupabaseAuthCookieAdapter(env.url, {
    getAll: () => typeof document === "undefined" ? [] : parseCookieHeader(document.cookie).map(cookie => ({ name: cookie.name, value: cookie.value ?? "" })),
    setAll: cookies => { if (typeof document !== "undefined") for (const cookie of cookies) document.cookie = serializeCookieHeader(cookie.name, cookie.value, cookie.options); },
  });
  return createBrowserClient(env.url, env.anonKey, { global: { fetch: supabaseAuthFetch(env.url) }, cookies: safeCookies });
}
