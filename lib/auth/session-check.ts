import type { SupabaseClient, User } from "@supabase/supabase-js";
type SessionClient = Pick<SupabaseClient, "auth" | "rpc">;
/** A fresh Auth user lookup validates identity; the narrow session RPC also
 * requires the JWT's exact session row to remain active after logout. This
 * guards server entry points, not unrelated direct Data API policies. */
export async function readCurrentServerUser(client: SessionClient): Promise<{ user: User | null; error: string | null }> {
  try {
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) return { user: null, error: result.error ? "Your sign-in could not be verified. Sign in again." : null };
    const { data, error } = await client.rpc("current_session_actor");
    if (error || typeof data !== "string" || data !== result.data.user.id) return { user: null, error: "Your session has ended or could not be verified. Sign in again." };
    return { user: result.data.user, error: null };
  } catch { return { user: null, error: "Your session could not be verified. Try again shortly." }; }
}
