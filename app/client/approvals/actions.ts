"use server";

import { revalidatePath } from "next/cache";

import {
  resolveApprovalItem,
  type ApprovalResolution,
} from "@/lib/approvals/resolve";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { CLIENT_APPROVER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function resolveClientApproval(
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
    // The client scope comes from the signed-in user's own membership; a
    // browser-supplied client id is never trusted here.
    const access = await requirePrimaryClientAccess(
      authState.user.id,
      CLIENT_APPROVER_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase || !access.clientId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const result = await resolveApprovalItem({
      supabase,
      access,
      approvalId,
      clientId: access.clientId,
      resolution: resolution as ApprovalResolution,
      editedContent: String(formData.get("edited_content") ?? ""),
      note: String(formData.get("note") ?? ""),
    });

    if (result.status === "success") {
      revalidatePath("/client/approvals");
      revalidatePath("/client");
    }

    return result;
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "Your account cannot resolve approvals."
            : "Approvals are unavailable right now. Try again shortly.",
      };
    }

    throw error;
  }
}
