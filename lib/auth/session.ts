import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";

import { isLocalDevAutoLoginEnabled } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readCurrentServerUser } from "./session-check.ts";
import { notifyContextFailure, type ContextDiagnosticObserver } from "./context-diagnostics.ts";

export type AuthState = {
  isSupabaseConfigured: boolean;
  user: User | null;
  error: string | null;
};

export async function getAuthState(onFailure?: ContextDiagnosticObserver): Promise<AuthState> {
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try { supabase = await createSupabaseServerClient(); }
  catch (error) {
    notifyContextFailure(onFailure, "configuration", "unavailable", error);
    throw error;
  }

  if (!supabase) {
    notifyContextFailure(onFailure, "configuration", "unavailable");
    return {
      isSupabaseConfigured: false,
      user: null,
      error: null,
    };
  }

  const { user, error } = await readCurrentServerUser(supabase, onFailure);
  return { isSupabaseConfigured: true, user, error };
}

export async function requireAuthenticatedUser(nextPath = "/partner", onFailure?: ContextDiagnosticObserver) {
  const authState = await getAuthState(onFailure);

  if (!authState.user) {
    if (isLocalDevAutoLoginEnabled()) {
      redirect(`/dev/auto-login?next=${encodeURIComponent(nextPath)}`);
    }

    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }

  return authState.user;
}
