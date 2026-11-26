import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getSupabasePublicEnv } from "@/lib/env";
import { createSupabaseAuthCookieAdapter, supabaseAuthFetch } from "./auth-cookie-safety";

export async function createSupabaseServerClient() {
  const env = getSupabasePublicEnv();

  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  const safeCookies = createSupabaseAuthCookieAdapter(env.url, {
    getAll() {
      return cookieStore.getAll();
    },
    setAll(cookiesToSet) {
      try {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options);
        });
      } catch {
        // Server components cannot always write cookies; middleware handles refresh.
      }
    },
  });
  return createServerClient(env.url, env.anonKey, {
    global: { fetch: supabaseAuthFetch(env.url) },
    cookies: safeCookies,
  });
}
