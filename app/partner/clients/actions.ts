"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { recordAuditEvent } from "@/lib/audit/audit";
import { InvitationIdentityError, findVerifiedInvitationIdentity, assertClientIdentityIsIndependent } from "@/lib/auth/invitation-identity";
import { getAuthState } from "@/lib/auth/session";
import {
  CLIENT_EXPERIENCE_MODES,
  CLIENT_STATUSES,
  CRM_OPERATING_MODES,
  RUNTIME_MODES,
  type ClientBusinessRecord,
} from "@/lib/clients/constants";
import type { FormState } from "@/lib/forms/state";
import { getAppUrl } from "@/lib/env";
import { permissionsForJobRole } from "@/lib/permissions/client-sections";
import {
  isAccessError,
  requireClientWorkspaceAccess,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type ClientFieldValues = {
  name: string;
  industry: string;
  timezone: string;
  status: string;
  clientExperienceMode: string;
  crmOperatingMode: string;
  defaultRuntimeMode: string;
  websiteUrl: string;
  primaryContactName: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  clientPortalEnabled: boolean;
  partnerCanEditClientData: boolean;
  packageId: string;
};

function readFields(formData: FormData): ClientFieldValues {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  return {
    name: text("name"),
    industry: text("industry"),
    timezone: text("timezone"),
    status: text("status") || "onboarding",
    clientExperienceMode: text("client_experience_mode"),
    crmOperatingMode: text("crm_operating_mode"),
    defaultRuntimeMode: text("default_runtime_mode"),
    websiteUrl: text("website_url"),
    primaryContactName: text("primary_contact_name"),
    primaryContactEmail: text("primary_contact_email"),
    primaryContactPhone: text("primary_contact_phone"),
    clientPortalEnabled: formData.get("client_portal_enabled") === "on",
    partnerCanEditClientData:
      formData.get("partner_can_edit_client_data") === "on",
    packageId: text("package_id"),
  };
}

function validateFields(
  fields: ClientFieldValues,
  options: { requirePackage?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!fields.name) {
    errors.name = "Client name is required.";
  }

  if (!fields.industry) {
    errors.industry = "Industry is required.";
  }

  if (!fields.timezone) {
    errors.timezone = "Timezone is required.";
  }

  if (fields.clientPortalEnabled && !fields.primaryContactEmail) {
    errors.primary_contact_email =
      "A client-owner email is required to send workspace access.";
  } else if (!fields.primaryContactEmail && !fields.primaryContactPhone) {
    errors.primary_contact_email =
      "A primary contact email or phone is required.";
  }

  if (
    fields.primaryContactEmail &&
    !fields.primaryContactEmail.includes("@")
  ) {
    errors.primary_contact_email = "Enter a valid contact email.";
  }

  if (!CRM_OPERATING_MODES.includes(fields.crmOperatingMode as never)) {
    errors.crm_operating_mode = "Choose a CRM operating mode.";
  }

  if (
    !CLIENT_EXPERIENCE_MODES.includes(fields.clientExperienceMode as never)
  ) {
    errors.client_experience_mode = "Choose a client experience.";
  }

  if (!RUNTIME_MODES.includes(fields.defaultRuntimeMode as never)) {
    errors.default_runtime_mode = "Choose a default runtime mode.";
  }

  if (!CLIENT_STATUSES.includes(fields.status as never)) {
    errors.status = "Choose a valid status.";
  }

  if (options.requirePackage && !fields.packageId) {
    errors.package_id = "Choose the package this client purchased.";
  }

  if (fields.websiteUrl && !/^https?:\/\//.test(fields.websiteUrl)) {
    errors.website_url = "Website must start with http:// or https://.";
  }

  return errors;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return base || "client";
}

function accessErrorState(error: unknown): FormState {
  if (error instanceof InvitationIdentityError) return { status: "error", message: error.message };
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to manage client businesses."
          : "Client management is unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

export async function createClientBusiness(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage clients." };
  }

  const fields = readFields(formData);
  const fieldErrors = validateFields(fields, { requirePackage: true });

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  let clientId: string;

  try {
    const access = await requirePrimaryPartnerAccess(
      authState.user.id,
      PARTNER_MANAGER_ROLES,
    );

    if (!access.partnerId) {
      return { status: "error", message: "Partner access required." };
    }

    const supabase = await createSupabaseServerClient();
    const admin = createSupabaseAdminClient();

    if (!supabase || !admin) {
      return {
        status: "error",
        message: "The data service is not configured for this environment.",
      };
    }

    const { data: selectedPackage, error: packageError } = await supabase
      .from("partner_packages")
      .select("id, name")
      .eq("id", fields.packageId)
      .eq("partner_id", access.partnerId)
      .eq("is_archived", false)
      .is("client_id", null)
      .maybeSingle();

    if (packageError || !selectedPackage) {
      return {
        status: "error",
        message: "The selected package is no longer available.",
        fieldErrors: { package_id: "Choose an available package." },
      };
    }

    const baseSlug = slugify(fields.name);
    const { data: existingSlugs, error: slugError } = await supabase
      .from("client_businesses")
      .select("slug")
      .eq("partner_id", access.partnerId)
      .like("slug", `${baseSlug}%`);

    if (slugError) {
      return { status: "error", message: "Could not verify the client name." };
    }

    const taken = new Set((existingSlugs ?? []).map((row) => row.slug));
    let slug = baseSlug;
    let suffix = 2;

    while (taken.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const existingProfile = fields.primaryContactEmail
      ? await findVerifiedInvitationIdentity(admin, fields.primaryContactEmail) : null;
    if (existingProfile) await assertClientIdentityIsIndependent(admin, existingProfile.id);

    const { data: created, error: insertError } = await supabase
      .from("client_businesses")
      .insert({
        partner_id: access.partnerId,
        name: fields.name,
        slug,
        status: fields.status,
        industry: fields.industry,
        client_experience_mode: fields.clientExperienceMode,
        crm_operating_mode: fields.crmOperatingMode,
        default_runtime_mode: fields.defaultRuntimeMode,
        website_url: fields.websiteUrl || null,
        primary_contact_name: fields.primaryContactName || null,
        primary_contact_email: fields.primaryContactEmail || null,
        primary_contact_phone: fields.primaryContactPhone || null,
        timezone: fields.timezone,
        client_portal_enabled: fields.clientPortalEnabled,
        partner_can_edit_client_data: fields.partnerCanEditClientData,
        package_id: selectedPackage.id,
      })
      .select("id, name, status")
      .single();

    if (insertError || !created) {
      return {
        status: "error",
        message: insertError?.code === "P1001" || insertError?.code === "P1002"
          ? insertError.message
          : "The client could not be created. Try again.",
      };
    }

    clientId = created.id;

    let invitedUserId: string | null = null;
    let createdInvitationUser = false;
    let ownerMembershipId: string | null = null;

    if (fields.primaryContactEmail) {
      const email = fields.primaryContactEmail.toLowerCase();

      invitedUserId = existingProfile?.id ?? null;

      if (!invitedUserId) {
        const { data: invitation, error: invitationError } =
          await admin.auth.admin.inviteUserByEmail(email, {
            data: {
              full_name: fields.primaryContactName || fields.name,
            },
            redirectTo: `${getAppUrl()}/auth/confirm?next=/client`,
          });

        if (invitationError || !invitation.user) {
          await supabase.from("client_businesses").delete().eq("id", clientId);
          return {
            status: "error",
            message:
              invitationError?.message ??
              "The client workspace invitation could not be created.",
          };
        }

        invitedUserId = invitation.user.id;
        createdInvitationUser = true;
      }

      const ownerPermissions = permissionsForJobRole("owner");
      const { data: membership, error: membershipError } = await admin
        .from("memberships")
        .insert({
          user_id: invitedUserId,
          partner_id: access.partnerId,
          client_id: clientId,
          role: "client_owner",
          status: "active",
          invited_by: access.userId,
          client_job_role: "owner",
          client_permissions: {
            sections: ownerPermissions.visibleSections,
            view_action_center: ownerPermissions.canViewActionCenter,
            resolve_approvals: ownerPermissions.canResolveApprovals,
            operate_customer_actions:
              ownerPermissions.canOperateCustomerActions,
            edit_crm_data: ownerPermissions.canEditCrmData,
          },
        })
        .select("id")
        .single();

      if (membershipError || !membership) {
        await supabase.from("client_businesses").delete().eq("id", clientId);
        if (createdInvitationUser && invitedUserId) {
          await admin.auth.admin.deleteUser(invitedUserId).catch(() => undefined);
        }
        return {
          status: "error",
          message: "The client owner could not be granted workspace access.",
        };
      }

      ownerMembershipId = membership.id;
    }

    await recordAuditEvent({
      actor: { ...access, clientId: created.id },
      action: "client.created",
      targetType: "client_business",
      targetId: created.id,
      summary: `Created client business "${fields.name}".`,
      afterSnapshot: {
        name: fields.name,
        status: fields.status,
        client_experience_mode: fields.clientExperienceMode,
        crm_operating_mode: fields.crmOperatingMode,
        default_runtime_mode: fields.defaultRuntimeMode,
        client_portal_enabled: fields.clientPortalEnabled,
        partner_can_edit_client_data: fields.partnerCanEditClientData,
        package_id: selectedPackage.id,
        package_name: selectedPackage.name,
      },
    });

    if (ownerMembershipId) {
      await recordAuditEvent({
        actor: { ...access, clientId: created.id },
        action: "client.owner_invited",
        targetType: "membership",
        targetId: ownerMembershipId,
        summary: createdInvitationUser
          ? `Invited ${fields.primaryContactEmail} as the client owner.`
          : `Granted ${fields.primaryContactEmail} client-owner access.`,
        metadata: {
          email: fields.primaryContactEmail.toLowerCase(),
          invitation_sent: createdInvitationUser,
        },
      });
    }
  } catch (error) {
    return accessErrorState(error);
  }

  revalidatePath("/partner/clients");
  // New clients land in the guided setup flow first.
  redirect(`/partner/clients/${clientId}/setup`);
}

export async function updateClientBusiness(
  clientId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to manage clients." };
  }

  const fields = readFields(formData);
  const fieldErrors = validateFields(fields);

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_MANAGER_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase) {
      return {
        status: "error",
        message: "The data service is not configured for this environment.",
      };
    }

    const { data: existing, error: existingError } = await supabase
      .from("client_businesses")
      .select("*")
      .eq("id", clientId)
      .maybeSingle();

    if (existingError || !existing) {
      return { status: "error", message: "The client could not be loaded." };
    }

    const before = existing as ClientBusinessRecord;

    const { error: updateError } = await supabase
      .from("client_businesses")
      .update({
        name: fields.name,
        status: fields.status,
        industry: fields.industry,
        client_experience_mode: fields.clientExperienceMode,
        crm_operating_mode: fields.crmOperatingMode,
        default_runtime_mode: fields.defaultRuntimeMode,
        website_url: fields.websiteUrl || null,
        primary_contact_name: fields.primaryContactName || null,
        primary_contact_email: fields.primaryContactEmail || null,
        primary_contact_phone: fields.primaryContactPhone || null,
        timezone: fields.timezone,
        client_portal_enabled: fields.clientPortalEnabled,
        partner_can_edit_client_data: fields.partnerCanEditClientData,
      })
      .eq("id", clientId)
      .eq("partner_id", access.partnerId ?? "");

    if (updateError) {
      return {
        status: "error",
        message: "Client settings could not be saved. Try again.",
      };
    }

    const summarize = (record: {
      name: string;
      status: string;
      client_experience_mode: string;
      crm_operating_mode: string;
      default_runtime_mode: string;
      timezone: string;
    }) => ({
      name: record.name,
      status: record.status,
      client_experience_mode: record.client_experience_mode,
      crm_operating_mode: record.crm_operating_mode,
      default_runtime_mode: record.default_runtime_mode,
      timezone: record.timezone,
    });

    await recordAuditEvent({
      actor: access,
      action: "client.settings_updated",
      targetType: "client_business",
      targetId: clientId,
      summary: `Updated settings for "${fields.name}".`,
      beforeSnapshot: summarize(before),
      afterSnapshot: summarize({
        name: fields.name,
        status: fields.status,
        client_experience_mode: fields.clientExperienceMode,
        crm_operating_mode: fields.crmOperatingMode,
        default_runtime_mode: fields.defaultRuntimeMode,
        timezone: fields.timezone,
      }),
    });

    if (before.client_portal_enabled !== fields.clientPortalEnabled) {
      await recordAuditEvent({
        actor: access,
        action: "client.portal_access_changed",
        targetType: "client_business",
        targetId: clientId,
        summary: `Client portal ${fields.clientPortalEnabled ? "enabled" : "disabled"} for "${fields.name}".`,
        beforeSnapshot: { client_portal_enabled: before.client_portal_enabled },
        afterSnapshot: { client_portal_enabled: fields.clientPortalEnabled },
      });
    }

    if (
      before.partner_can_edit_client_data !== fields.partnerCanEditClientData
    ) {
      await recordAuditEvent({
        actor: access,
        action: "client.partner_edit_permission_changed",
        targetType: "client_business",
        targetId: clientId,
        summary: `Partner edit permission ${fields.partnerCanEditClientData ? "granted" : "revoked"} for "${fields.name}".`,
        beforeSnapshot: {
          partner_can_edit_client_data: before.partner_can_edit_client_data,
        },
        afterSnapshot: {
          partner_can_edit_client_data: fields.partnerCanEditClientData,
        },
      });
    }
  } catch (error) {
    return accessErrorState(error);
  }

  revalidatePath(`/partner/clients/${clientId}`, "layout");
  revalidatePath("/partner/clients");

  return { status: "success", message: "Client settings saved." };
}

export async function archiveClientBusiness(clientId: string): Promise<void> {
  const authState = await getAuthState();

  if (!authState.user) {
    redirect("/login?next=/partner/clients");
  }

  const access = await requireClientWorkspaceAccess(
    authState.user.id,
    clientId,
    PARTNER_MANAGER_ROLES,
  );

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new Error("The data service is not configured for this environment.");
  }

  const { data: existing } = await supabase
    .from("client_businesses")
    .select("id, name, status")
    .eq("id", clientId)
    .maybeSingle();

  const { error } = await supabase
    .from("client_businesses")
    .update({ status: "archived" })
    .eq("id", clientId)
    .eq("partner_id", access.partnerId ?? "");

  if (error) {
    throw new Error("The client could not be archived.");
  }

  await recordAuditEvent({
    actor: access,
    action: "client.archived",
    targetType: "client_business",
    targetId: clientId,
    summary: `Archived client business "${existing?.name ?? clientId}".`,
    beforeSnapshot: { status: existing?.status ?? null },
    afterSnapshot: { status: "archived" },
  });

  revalidatePath("/partner/clients");
  redirect("/partner/clients");
}
