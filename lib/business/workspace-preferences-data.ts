import "server-only";
import type { ClientPortal } from "@/lib/clients/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { defaultWorkspacePreferences, parseWorkspacePreferences } from "./workspace-preferences";
import { WORKSPACE_MODULES, type WorkspaceActivity, type WorkspacePersonalization } from "./workspace-preferences-contract";

export function unavailableWorkspacePersonalization(): WorkspacePersonalization {
  return { preferences: defaultWorkspacePreferences(), activity: [], available: false, canEdit: false };
}

export async function loadWorkspacePersonalization(portal: Extract<ClientPortal, { kind: "ok" }>): Promise<WorkspacePersonalization> {
  if (portal.access.isImpersonating) return unavailableWorkspacePersonalization();
  const client = await createSupabaseServerClient();
  if (!client) return unavailableWorkspacePersonalization();
  try {
    const result = await client.rpc("get_owner_workspace_preferences", { p_client: portal.client.id });
    if (result.error || !result.data) return unavailableWorkspacePersonalization();
    const preferences = parseWorkspacePreferences(result.data.preferences);
    if (!preferences) throw new Error("Invalid preferences");
    if (!Array.isArray(result.data.activity)) throw new Error("Missing activity");
    const activity: WorkspaceActivity[] = result.data.activity.map((item: WorkspaceActivity) => {
      if (!item || !WORKSPACE_MODULES.includes(item.module) || !Number.isInteger(item.days) || item.days < 1 || item.days > 14) throw new Error("Invalid activity");
      return { module: item.module, days: item.days };
    });
    return { preferences, activity, available: true, canEdit: true };
  } catch { return unavailableWorkspacePersonalization(); }
}
