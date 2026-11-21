import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { isLocalDevAutoLoginEnabled } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readCurrentServerUser } from "./session-check.ts";

export type AuthState = {
  isSupabaseConfigured: boolean;
  user: User | null;
  error: string | null;
};

export async function getAuthState(): Promise<AuthState> {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      isSupabaseConfigured: false,
      user: null,
      error: null,
    };
  }

  const { user, error } = await readCurrentServerUser(supabase);
  return { isSupabaseConfigured: true, user, error };
}

export async function requireAuthenticatedUser(nextPath = "/partner") {
  const authState = await getAuthState();

  if (!authState.user) {
    if (isLocalDevAutoLoginEnabled()) {
      redirect(`/dev/auto-login?next=${encodeURIComponent(nextPath)}`);
    }

    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return authState.user;
}
