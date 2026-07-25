"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/forms/state";
import {
  CLIENT_JOB_ROLES,
  CLIENT_SECTION_KEYS,
  membershipRoleForJobRole,
  permissionsForJobRole,
  type ClientJobRole,
  type ClientSectionKey,
} from "@/lib/permissions/client-sections";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type EditableJobRole = Exclude<ClientJobRole, "owner">;

function result(
  message: string,
  status: "success" | "error" = "success",
): FormState {
  return { status, message };
}

function clean(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function editableJobRole(value: unknown): EditableJobRole | null {
  const candidate = clean(value, 40) as ClientJobRole;
  return CLIENT_JOB_ROLES.includes(candidate) && candidate !== "owner"
    ? candidate
    : null;
}

function selectedSections(values: unknown): ClientSectionKey[] {
  if (!Array.isArray(values)) return [];

  return [...new Set(
    values.filter(
      (value): value is ClientSectionKey =>
        typeof value === "string" &&
        CLIENT_SECTION_KEYS.includes(value as ClientSectionKey),
    ),
  )];
}

async function ownerContext() {
  const auth = await getAuthState();

  if (!auth.user) {
    return {
      ok: false as const,
      error: result("Sign in to manage team access.", "error"),
    };
  }

  try {
    const access = await requirePrimaryClientAccess(auth.user.id, [
      "client_owner",
    ]);
    const admin = createSupabaseAdminClient();

    if (!admin || !access.clientId || !access.partnerId) {
      return { error: result("Team access is unavailable.", "error") };
    }

    return { ok: true as const, access, admin };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        ok: false as const,
        error: result(
          "Only the business owner can manage team access.",
          "error",
        ),
      };
    }

    throw error;
  }
}

function revalidateTeam() {
  revalidatePath("/client");
  revalidatePath("/client/crm");
  revalidatePath("/client/action-center");
  revalidatePath("/client/assistant");
  revalidatePath("/client/approvals");
  revalidatePath("/client/activity");
}

export async function inviteClientTeamMember(input: {
  email: string;
  fullName: string;
  jobRole: string;
}): Promise<FormState> {
  const context = await ownerContext();
  if (!context.ok) return context.error;

  const email = clean(input.email, 320).toLowerCase();
  const fullName = clean(input.fullName, 120);
  const jobRole = editableJobRole(input.jobRole);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return result("Enter a valid work email.", "error");
  }

  if (!fullName || !jobRole) {
    return result("Enter a name and choose a team role.", "error");
  }

  const { access, admin } = context;
  const { data: existingProfile } = await admin
    .from("profiles")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  let userId = existingProfile?.id ?? null;

  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName },
      redirectTo: `${getAppUrl()}/auth/callback?next=/client`,
    });

    if (error || !data.user) {
      return result(
        error?.message ?? "The invitation could not be created.",
        "error",
      );
    }

    userId = data.user.id;
  }

  const { data: existingMembership } = await admin
    .from("memberships")
    .select("id, status")
    .eq("user_id", userId)
    .eq("client_id", access.clientId)
    .limit(1)
    .maybeSingle();

  if (existingMembership?.status === "active") {
    return result("That person already has access.", "error");
  }

  const defaults = permissionsForJobRole(jobRole);
  const membershipValues = {
    user_id: userId,
    partner_id: access.partnerId,
    client_id: access.clientId,
    role: membershipRoleForJobRole(jobRole),
    status: "active",
    invited_by: access.userId,
    client_job_role: jobRole,
    client_permissions: {
      sections: defaults.visibleSections,
      view_action_center: defaults.canViewActionCenter,
      resolve_approvals: defaults.canResolveApprovals,
      operate_customer_actions: defaults.canOperateCustomerActions,
      edit_crm_data: defaults.canEditCrmData,
    },
  };
  const mutation = existingMembership
    ? admin
        .from("memberships")
        .update(membershipValues)
        .eq("id", existingMembership.id)
    : admin.from("memberships").insert(membershipValues);
  const { error: membershipError } = await mutation;

  if (membershipError) {
    return result("The team member could not be added.", "error");
  }

  await recordAuditEvent({
    actor: access,
    action: "client.team_member_invited",
    targetType: "membership",
    targetId: existingMembership?.id ?? null,
    summary: `${fullName} was added as ${jobRole.replaceAll("_", " ")}.`,
    metadata: { email, job_role: jobRole },
  });

  revalidateTeam();
  return result(
    existingProfile
      ? `${fullName} can now access the workspace.`
      : `Invitation sent to ${email}.`,
  );
}

export async function updateClientTeamMemberAccess(input: {
  membershipId: string;
  jobRole: string;
  status: string;
  sections: string[];
  canResolveApprovals: boolean;
  canOperateCustomerActions: boolean;
  canEditCrmData: boolean;
  canViewActionCenter: boolean;
}): Promise<FormState> {
  const context = await ownerContext();
  if (!context.ok) return context.error;

  const jobRole = editableJobRole(input.jobRole);
  const sections = selectedSections(input.sections);
  const status = input.status === "disabled" ? "disabled" : "active";

  if (!validUuid(input.membershipId) || !jobRole) {
    return result("Choose a valid team member and role.", "error");
  }

  if (sections.length === 0 && !input.canViewActionCenter) {
    return result(
      "Choose at least one visible workspace section.",
      "error",
    );
  }

  const { access, admin } = context;
  const { data: membership } = await admin
    .from("memberships")
    .select("id, user_id, role, client_job_role, client_permissions, status")
    .eq("id", input.membershipId)
    .eq("client_id", access.clientId)
    .eq("partner_id", access.partnerId)
    .maybeSingle();

  if (!membership) {
    return result("Team member not found.", "error");
  }

  if (
    membership.role === "client_owner" ||
    membership.user_id === access.userId
  ) {
    return result("Owner access cannot be changed here.", "error");
  }

  const visibleSections: ClientSectionKey[] = sections.filter(
    (section) => section !== "action-center",
  );

  if (input.canViewActionCenter) {
    visibleSections.push("action-center");
  }

  const after = {
    role: membershipRoleForJobRole(jobRole),
    client_job_role: jobRole,
    status,
    client_permissions: {
      sections: visibleSections,
      view_action_center: input.canViewActionCenter,
      resolve_approvals: input.canResolveApprovals,
      operate_customer_actions: input.canOperateCustomerActions,
      edit_crm_data: input.canEditCrmData,
    },
  };
  const { error } = await admin
    .from("memberships")
    .update(after)
    .eq("id", membership.id);

  if (error) {
    return result("Team access could not be updated.", "error");
  }

  await recordAuditEvent({
    actor: access,
    action: "client.team_member_access_updated",
    targetType: "membership",
    targetId: membership.id,
    summary: `Team access updated for ${jobRole.replaceAll("_", " ")}.`,
    beforeSnapshot: {
      role: membership.role,
      job_role: membership.client_job_role,
      status: membership.status,
      permissions: membership.client_permissions,
    },
    afterSnapshot: after,
  });

  revalidateTeam();
  return result("Team access updated.");
}
