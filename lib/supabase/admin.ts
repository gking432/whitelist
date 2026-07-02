import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { getSupabasePublicEnv, getSupabaseServiceRoleKey } from "@/lib/env";

// Service-role client for trusted server paths (webhook intake, run engine).
// It bypasses RLS, so every caller must scope queries by partner/client
// explicitly. Never import from client components.
export function createSupabaseAdminClient(): SupabaseClient | null {
  const env = getSupabasePublicEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!env || !serviceRoleKey) {
    return null;
  }

  return createClient(env.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
