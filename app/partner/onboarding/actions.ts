"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { updatePartnerBranding } from "@/app/partner/settings/actions";
import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/forms/state";
import {
  furthestOnboardingStep,
  PARTNER_V1_PLAN,
  type PartnerOnboardingRecord,
  type PartnerOnboardingStep,
} from "@/lib/onboarding/partner";
import { ensurePartnerAgencyBusiness } from "@/lib/partners/agency-business";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const PARTNER_TEAM_ROLES = [
  "partner_admin",
  "partner_implementer",
  "partner_viewer",
] as const;

type PartnerTeamRole = (typeof PARTNER_TEAM_ROLES)[number];

function clean(formData: FormData, key: string, max = 320): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validOptionalUrl(value: string): boolean {
  if (!value) return true;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function accessErrorState(error: unknown): FormState {
  if (isAccessError(error)) {
    return {
      status: "error",
      message:
        error.code === "ACCESS_DENIED"
          ? "Partner owner or admin access is required."
          : "Onboarding is unavailable right now. Try again shortly.",
    };
  }

  throw error;
}

async function onboardingContext() {
  const auth = await getAuthState();
  if (!auth.user) return null;

  const access = await requirePrimaryPartnerAccess(
    auth.user.id,
    PARTNER_MANAGER_ROLES,
  );
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();

  if (!supabase || !admin || !access.partnerId) return null;

  return { access, admin, supabase, user: auth.user };
}

async function updateOnboardingProgress(
  supabase: NonNullable<
    Awaited<ReturnType<typeof createSupabaseServerClient>>
  >,
  partnerId: string,
  nextStep: PartnerOnboardingStep,
  values: Record<string, unknown> = {},
) {
  const { data: existing } = await supabase
    .from("partner_onboarding")
    .select("*")
    .eq("partner_id", partnerId)
    .maybeSingle();
  const current =
    (existing as PartnerOnboardingRecord | null)?.current_step ?? "agency";
  const currentStep = furthestOnboardingStep(current, nextStep);
  const { error } = await supabase.from("partner_onboarding").upsert(
    {
      partner_id: partnerId,
      status: "in_progress",
      current_step: currentStep,
      ...values,
    },
    { onConflict: "partner_id" },
  );

  if (error) throw new Error(error.message);
}

export async function savePartnerAgencyDetails(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const agencyName = clean(formData, "agency_name", 100);
  const websiteUrl = clean(formData, "website_url");
  const supportEmail = clean(formData, "support_email").toLowerCase();
  const supportPhone = clean(formData, "support_phone", 40);
  const fieldErrors: Record<string, string> = {};

  if (agencyName.length < 2) {
    fieldErrors.agency_name = "Enter your agency name.";
  }
  if (!validOptionalUrl(websiteUrl)) {
    fieldErrors.website_url = "Enter a full URL such as https://agency.com.";
  }
  if (!validEmail(supportEmail)) {
    fieldErrors.support_email = "Enter a valid support email.";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted agency details.",
      fieldErrors,
    };
  }

  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to continue onboarding." };
    }

    const { access, admin, supabase } = context;
    const { data: before, error: loadError } = await supabase
      .from("partners")
      .select("name, website_url, support_email, support_phone")
      .eq("id", access.partnerId!)
      .maybeSingle();

    if (loadError || !before) {
      return { status: "error", message: "Agency details could not be loaded." };
    }

    const values = {
      name: agencyName,
      website_url: websiteUrl || null,
      support_email: supportEmail,
      support_phone: supportPhone || null,
    };
    const { error } = await supabase
      .from("partners")
      .update(values)
      .eq("id", access.partnerId!);

    if (error) {
      return { status: "error", message: "Agency details could not be saved." };
    }

    const agency = await ensurePartnerAgencyBusiness(admin, {
      partnerId: access.partnerId!,
      userId: access.userId,
    });

    await admin
      .from("client_businesses")
      .update({
        name: agencyName,
        website_url: websiteUrl || null,
        primary_contact_email: supportEmail,
        primary_contact_phone: supportPhone || null,
      })
      .eq("id", agency.id);

    await updateOnboardingProgress(
      supabase,
      access.partnerId!,
      "branding",
    );
    await recordAuditEvent({
      actor: access,
      action: "partner.onboarding_agency_saved",
      targetType: "partner",
      targetId: access.partnerId!,
      summary: `Saved onboarding details for "${agencyName}".`,
      beforeSnapshot: before,
      afterSnapshot: values,
    });

    revalidatePath("/partner");
    revalidatePath("/partner/onboarding");
    redirect("/partner/onboarding?step=branding");
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function saveOnboardingBranding(
  previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await updatePartnerBranding(previousState, formData);
  if (result.status !== "success") return result;

  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to continue onboarding." };
    }

    await updateOnboardingProgress(
      context.supabase,
      context.access.partnerId!,
      "team",
    );
    revalidatePath("/partner/onboarding");
    redirect("/partner/onboarding?step=team");
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function invitePartnerTeamMember(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const fullName = clean(formData, "full_name", 120);
  const email = clean(formData, "email").toLowerCase();
  const roleValue = clean(formData, "role", 40);
  const role = PARTNER_TEAM_ROLES.includes(roleValue as PartnerTeamRole)
    ? (roleValue as PartnerTeamRole)
    : null;
  const fieldErrors: Record<string, string> = {};

  if (!fullName) fieldErrors.full_name = "Enter the team member's name.";
  if (!validEmail(email)) fieldErrors.email = "Enter a valid work email.";
  if (!role) fieldErrors.role = "Choose a valid partner role.";

  if (Object.keys(fieldErrors).length > 0) {
    return {
      status: "error",
      message: "Fix the highlighted invitation details.",
      fieldErrors,
    };
  }
  const selectedRole = role as PartnerTeamRole;

  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to invite your team." };
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
        redirectTo: `${getAppUrl()}/auth/callback?next=/partner`,
      });

      if (error || !data.user) {
        return {
          status: "error",
          message: error?.message ?? "The invitation could not be sent.",
        };
      }
      userId = data.user.id;
    }

    if (userId === access.userId) {
      return {
        status: "error",
        message: "You already own this partner workspace.",
      };
    }

    const { data: existingMembership } = await admin
      .from("memberships")
      .select("id, status")
      .eq("user_id", userId)
      .eq("partner_id", access.partnerId!)
      .is("client_id", null)
      .limit(1)
      .maybeSingle();

    if (existingMembership?.status === "active") {
      return { status: "error", message: "That person already has access." };
    }

    const membershipValues = {
      user_id: userId,
      partner_id: access.partnerId!,
      client_id: null,
      role: selectedRole,
      status: "active",
      invited_by: access.userId,
    };
    const mutation = existingMembership
      ? admin
          .from("memberships")
          .update(membershipValues)
          .eq("id", existingMembership.id)
      : admin.from("memberships").insert(membershipValues);
    const { error: membershipError } = await mutation;

    if (membershipError) {
      return {
        status: "error",
        message: "The team member could not be added.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "partner.team_member_invited",
      targetType: "membership",
      targetId: existingMembership?.id ?? null,
      summary: `${fullName} was added as ${selectedRole.replaceAll("_", " ")}.`,
      metadata: { email, role: selectedRole },
    });

    revalidatePath("/partner/onboarding");
    return {
      status: "success",
      message: existingProfile
        ? `${fullName} can now access the partner workspace.`
        : `Invitation sent to ${email}.`,
    };
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function finishPartnerTeamStep(
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to continue onboarding." };
    }

    await updateOnboardingProgress(
      context.supabase,
      context.access.partnerId!,
      "integrations",
    );
    redirect("/partner/onboarding?step=integrations");
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function finishPartnerIntegrationsStep(
  _previousState: FormState,
  _formData: FormData,
): Promise<FormState> {
  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to continue onboarding." };
    }

    await updateOnboardingProgress(
      context.supabase,
      context.access.partnerId!,
      "plan",
      { integrations_reviewed_at: new Date().toISOString() },
    );
    redirect("/partner/onboarding?step=plan");
  } catch (error) {
    return accessErrorState(error);
  }
}

export async function completePartnerOnboarding(
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  if (formData.get("plan_acknowledged") !== "on") {
    return {
      status: "error",
      message: "Confirm that you understand the current plan structure.",
      fieldErrors: {
        plan_acknowledged: "Plan confirmation is required to finish setup.",
      },
    };
  }

  try {
    const context = await onboardingContext();
    if (!context) {
      return { status: "error", message: "Sign in to finish onboarding." };
    }

    const { access, admin, supabase } = context;
    const now = new Date().toISOString();
    const { error } = await supabase.from("partner_onboarding").upsert(
      {
        partner_id: access.partnerId!,
        status: "completed",
        current_step: "plan",
        plan_key: PARTNER_V1_PLAN.key,
        setup_fee_cents: PARTNER_V1_PLAN.setupFeeCents,
        monthly_fee_cents: PARTNER_V1_PLAN.monthlyFeeCents,
        included_active_clients: PARTNER_V1_PLAN.includedActiveClients,
        additional_client_fee_cents:
          PARTNER_V1_PLAN.additionalClientFeeCents,
        billing_status: "not_configured",
        plan_confirmed_at: now,
        completed_at: now,
      },
      { onConflict: "partner_id" },
    );

    if (error) {
      return { status: "error", message: "Onboarding could not be completed." };
    }

    await supabase
      .from("partners")
      .update({ plan_key: PARTNER_V1_PLAN.key })
      .eq("id", access.partnerId!);
    await ensurePartnerAgencyBusiness(admin, {
      partnerId: access.partnerId!,
      userId: access.userId,
    });
    await recordAuditEvent({
      actor: access,
      action: "partner.onboarding_completed",
      targetType: "partner",
      targetId: access.partnerId!,
      summary: "Completed partner onboarding.",
      afterSnapshot: {
        plan_key: PARTNER_V1_PLAN.key,
        setup_fee_cents: PARTNER_V1_PLAN.setupFeeCents,
        monthly_fee_cents: PARTNER_V1_PLAN.monthlyFeeCents,
        included_active_clients: PARTNER_V1_PLAN.includedActiveClients,
        billing_status: "not_configured",
      },
    });

    revalidatePath("/partner");
    revalidatePath("/partner/onboarding");
    redirect("/partner?onboarding=complete");
  } catch (error) {
    return accessErrorState(error);
  }
}
