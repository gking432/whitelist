"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  LEAD_SOURCE_KEYS,
  WEBSITE_PLATFORM_KEYS,
  emptyIntakeAnswers,
  type IntakeAnswers,
  type LeadSourceKey,
  type WebsitePlatformKey,
  type YesNoUnsure,
} from "@/lib/lead-sources/catalog";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const YES_NO_UNSURE: YesNoUnsure[] = ["yes", "no", "unsure"];

// Never trust the browser-shaped answers object: rebuild it against the
// catalog so only known keys/values are stored.
function sanitizeAnswers(input: unknown): IntakeAnswers {
  const raw = (input ?? {}) as Partial<IntakeAnswers>;

  const leadSources = Array.isArray(raw.leadSources)
    ? [
        ...new Set(
          raw.leadSources.filter((source): source is LeadSourceKey =>
            LEAD_SOURCE_KEYS.includes(source as LeadSourceKey),
          ),
        ),
      ]
    : [];

  const yesNoUnsure = (value: unknown): YesNoUnsure =>
    YES_NO_UNSURE.includes(value as YesNoUnsure)
      ? (value as YesNoUnsure)
      : "unsure";

  return {
    leadSources,
    websitePlatform: WEBSITE_PLATFORM_KEYS.includes(
      raw.websitePlatform as WebsitePlatformKey,
    )
      ? (raw.websitePlatform as WebsitePlatformKey)
      : "unknown",
    canEditWebsite: yesNoUnsure(raw.canEditWebsite),
    hasCrm: yesNoUnsure(raw.hasCrm),
    hasPhoneProvider: yesNoUnsure(raw.hasPhoneProvider),
    hasMessagingProvider: yesNoUnsure(raw.hasMessagingProvider),
    hasCalendar: yesNoUnsure(raw.hasCalendar),
  };
}

export async function saveLeadSourceProfile(
  clientId: string,
  answersInput: IntakeAnswers,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to save the setup plan." };
  }

  const answers = sanitizeAnswers(answersInput);

  if (answers.leadSources.length === 0) {
    return {
      status: "error",
      message: "Choose at least one lead source before saving.",
    };
  }

  try {
    const access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_OPERATOR_ROLES,
    );

    const supabase = await createSupabaseServerClient();

    if (!supabase || !access.partnerId) {
      return { status: "error", message: "The data service is unavailable." };
    }

    const { data: existing, error: existingError } = await supabase
      .from("client_businesses")
      .select("id, name, lead_source_profile")
      .eq("id", clientId)
      .maybeSingle();

    if (existingError || !existing) {
      return { status: "error", message: "The client could not be loaded." };
    }

    const previousProfile =
      (existing.lead_source_profile as { answers?: IntakeAnswers } | null) ??
      {};

    const profile = {
      answers,
      saved_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("client_businesses")
      .update({ lead_source_profile: profile })
      .eq("id", clientId)
      .eq("partner_id", access.partnerId);

    if (updateError) {
      return {
        status: "error",
        message: "The setup plan could not be saved. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "client.lead_source_profile_updated",
      targetType: "client_business",
      targetId: clientId,
      summary: `Updated the lead source setup plan for "${existing.name}".`,
      beforeSnapshot: {
        answers: previousProfile.answers ?? emptyIntakeAnswers,
      },
      afterSnapshot: { answers },
    });

    revalidatePath(`/partner/clients/${clientId}`, "layout");

    return { status: "success", message: "Setup plan saved." };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "You do not have permission to manage setup for this client."
            : "Setup is unavailable right now. Try again shortly.",
      };
    }

    throw error;
  }
}
