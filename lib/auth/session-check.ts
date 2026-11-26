import type { SupabaseClient, User } from "@supabase/supabase-js";
import { classifyContextFailure, notifyContextFailure, type ContextDiagnosticObserver, type ContextDiagnosticStage } from "./context-diagnostics.ts";
type SessionClient = Pick<SupabaseClient, "auth" | "rpc">;
/** A fresh Auth user lookup validates identity; the narrow session RPC also
 * requires the JWT's exact session row to remain active after logout. This
 * guards server entry points, not unrelated direct Data API policies. */
export async function readCurrentServerUser(client: SessionClient, onFailure?: ContextDiagnosticObserver): Promise<{ user: User | null; error: string | null }> {
  let stage: ContextDiagnosticStage = "auth_user";
  try {
    const result = await client.auth.getUser();
    if (result.error || !result.data.user) {
      notifyContextFailure(onFailure, stage, result.error ? classifyContextFailure(result.error) : "denied", result.error);
      return { user: null, error: result.error ? "Your sign-in could not be verified. Sign in again." : null };
    }
    stage = "session_actor";
    const actorResult = await client.rpc("current_session_actor");
    const { data, error } = actorResult;
    if (error || typeof data !== "string" || data !== result.data.user.id) {
      notifyContextFailure(onFailure, stage, error ? classifyContextFailure(error, actorResult.status) : typeof data !== "string" ? "unavailable" : "denied", error, actorResult.status);
      return { user: null, error: "Your session has ended or could not be verified. Sign in again." };
    }
    return { user: result.data.user, error: null };
  } catch (error) {
    notifyContextFailure(onFailure, stage, "unavailable", error);
    return { user: null, error: "Your session could not be verified. Try again shortly." };
  }
}
