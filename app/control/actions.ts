"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { InvitationIdentityError, findVerifiedInvitationIdentity } from "@/lib/auth/invitation-identity";
import { getAuthState } from "@/lib/auth/session";
import {
  partnerSlugBase,
  validateNewPartnerFields,
} from "@/lib/control/partner-provisioning";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/forms/state";
import { isAccessError, requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const PARTNER_MANAGEMENT_ROLES = [
  "platform_owner",
  "platform_admin",
] as const;

function readFields(formData: FormData) {
  const value = (name: string) => {
    const field = formData.get(name);
    return typeof field === "string" ? field.trim() : "";
  };

  return {
    agencyName: value("agency_name"),
    ownerName: value("owner_name"),
    ownerEmail: value("owner_email").toLowerCase(),
  };
}

export async function createPartnerAccount(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();
  if (!authState.user) {
    return { status: "error", message: "Sign in to create a partner." };
  }

  const fields = readFields(formData);
  const fieldErrors = validateNewPartnerFields(fields);
  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted fields and try again.",
      fieldErrors,
    };
  }

  try {
    const access = await requirePlatformRole(
      authState.user.id,
      PARTNER_MANAGEMENT_ROLES,
    );
    const admin = createSupabaseAdminClient();
    if (!admin) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const existingProfile = await findVerifiedInvitationIdentity(admin, fields.ownerEmail);

    if (existingProfile) {
      const { data: partnerMembership, error: membershipLookupError } =
        await admin
          .from("memberships")
          .select("id")
          .eq("user_id", existingProfile.id)
          .eq("status", "active")
          .in("role", [
            "partner_owner",
            "partner_admin",
            "partner_implementer",
            "partner_viewer",
          ])
          .limit(1)
          .maybeSingle();

      if (membershipLookupError) {
        return { status: "error", message: "Could not verify owner access." };
      }
      if (partnerMembership) {
        return {
          status: "error",
          message: "That email already belongs to a partner account.",
          fieldErrors: { owner_email: "Use a different owner email." },
        };
      }
    }

    const baseSlug = partnerSlugBase(fields.agencyName);
    const { data: slugRows, error: slugError } = await admin
      .from("partners")
      .select("slug")
      .like("slug", `${baseSlug}%`);
    if (slugError) {
      return { status: "error", message: "Could not verify the agency name." };
    }

    const taken = new Set((slugRows ?? []).map((row) => row.slug));
    let slug = baseSlug;
    let suffix = 2;
    while (taken.has(slug)) {
      slug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }

    const { data: partner, error: partnerError } = await admin
      .from("partners")
      .insert({
        name: fields.agencyName,
        slug,
        status: "trial",
        support_email: fields.ownerEmail,
      })
      .select("id")
      .single();

    if (partnerError || !partner) {
      return { status: "error", message: "The partner could not be created." };
    }

    let invitedUserId = existingProfile?.id ?? null;
    let createdInvitationUser = false;

    const cleanup = async () => {
      await admin.from("partners").delete().eq("id", partner.id);
      if (createdInvitationUser && invitedUserId) {
        await admin.auth.admin.deleteUser(invitedUserId).catch(() => undefined);
      }
    };

    const { error: setupError } = await admin.from("partner_branding").insert({
      partner_id: partner.id,
      product_name: `${fields.agencyName} CRM`,
      support_label: `${fields.agencyName} Support`,
      report_footer_text: `Managed by ${fields.agencyName}.`,
    });
    const { error: onboardingError } = await admin
      .from("partner_onboarding")
      .insert({
        partner_id: partner.id,
        status: "not_started",
        current_step: "agency",
        billing_status: "not_configured",
      });

    if (setupError || onboardingError) {
      await cleanup();
      return {
        status: "error",
        message: "The partner onboarding workspace could not be prepared.",
      };
    }

    if (!invitedUserId) {
      const { data: invitation, error: invitationError } =
        await admin.auth.admin.inviteUserByEmail(fields.ownerEmail, {
          data: { full_name: fields.ownerName },
          redirectTo: `${getAppUrl()}/auth/confirm?next=/partner/onboarding`,
        });

      if (invitationError || !invitation.user) {
        await cleanup();
        return {
          status: "error",
          message:
            invitationError?.message ?? "The owner invitation could not be sent.",
        };
      }

      invitedUserId = invitation.user.id;
      createdInvitationUser = true;
    }

    const { data: membership, error: membershipError } = await admin
      .from("memberships")
      .insert({
        user_id: invitedUserId,
        partner_id: partner.id,
        client_id: null,
        role: "partner_owner",
        status: "active",
        invited_by: access.userId,
      })
      .select("id")
      .single();

    if (membershipError || !membership) {
      await cleanup();
      return {
        status: "error",
        message: "The owner could not be granted partner access.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "partner.created",
      targetType: "partner",
      targetId: partner.id,
      summary: `Created partner account "${fields.agencyName}".`,
      afterSnapshot: {
        name: fields.agencyName,
        slug,
        status: "trial",
        owner_email: fields.ownerEmail,
      },
      metadata: {
        owner_membership_id: membership.id,
        invitation_sent: createdInvitationUser,
      },
    });

    revalidatePath("/control");
    return {
      status: "success",
      message: createdInvitationUser
        ? `Partner created. Invitation sent to ${fields.ownerEmail}.`
        : `Partner created. ${fields.ownerEmail} can sign in and begin onboarding.`,
    };
  } catch (error) {
    if (error instanceof InvitationIdentityError) return { status: "error", message: error.message };
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "Only platform owners and admins can create partners."
            : "Partner creation is unavailable right now.",
      };
    }
    throw error;
  }
}
