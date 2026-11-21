import { resolveAssistantAccess } from "@/lib/assistant/access";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SCENARIO_LAB_CLIENT_SLUG } from "@/lib/testing/scenarios";

function isScenarioLabEnabled() {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_SCENARIO_LAB === "true"
  );
}

export async function resolveVoiceOperatorAccess(
  userId: string,
  clientId: string,
): Promise<AccessContext> {
  try {
    return await resolveAssistantAccess(userId, clientId, "write");
  } catch (error) {
    if (
      !isScenarioLabEnabled() ||
      !isAccessError(error) ||
      error.code !== "ACCESS_DENIED"
    ) {
      throw error;
    }
  }

  const access = await requirePrimaryPartnerAccess(userId);
  const admin = createSupabaseAdminClient();

  if (!access.partnerId || !admin) {
    return resolveAssistantAccess(userId, clientId, "write");
  }

  const { data: labClient } = await admin
    .from("client_businesses")
    .select("id")
    .eq("id", clientId)
    .eq("partner_id", access.partnerId)
    .eq("slug", SCENARIO_LAB_CLIENT_SLUG)
    .maybeSingle();

  if (!labClient) {
    return resolveAssistantAccess(userId, clientId, "write");
  }

  return { ...access, clientId };
}
