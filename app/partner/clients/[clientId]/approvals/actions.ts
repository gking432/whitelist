"use server";

import { revalidatePath } from "next/cache";

import { resolveApprovalItem, type ApprovalResolution } from "@/lib/approvals/resolve";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function resolvePartnerApproval(
  clientId: string,
  approvalId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to resolve approvals." };
  }

  const resolution = String(formData.get("resolution") ?? "");

  if (!["approve", "edit_and_approve", "reject"].includes(resolution)) {
    return { status: "error", message: "Choose a valid resolution." };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const result = await resolveApprovalItem({
      supabase,
      access,
      approvalId,
      clientId,
      resolution: resolution as ApprovalResolution,
      editedContent: String(formData.get("edited_content") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    if (result.status === "success") {
      revalidatePath(`/partner/clients/${clientId}/approvals`);
      revalidatePath(`/partner/clients/${clientId}/runs`);
    }

    return result;
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "You do not have permission to resolve approvals for this client."
            : "Approvals are unavailable right now. Try again shortly.",
      };
    }

    throw error;
  }
}
