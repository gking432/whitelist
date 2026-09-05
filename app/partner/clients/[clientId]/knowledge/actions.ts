"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import type { FaqEntry } from "@/lib/knowledge/profile";
import {
  isAccessError,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import { PARTNER_OPERATOR_ROLES } from "@/lib/permissions/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Saves the client's approved AI knowledge. Every change is audited — this
// text is exactly what chat/voice/drafting assistants are allowed to say.

const DISCLOSURE_MODES = ["off", "explicit", "minimal"] as const;

function parseFaq(raw: string): FaqEntry[] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [q, ...rest] = line.split("::");
      return { q: q?.trim() ?? "", a: rest.join("::").trim() };
    })
    .filter((entry) => entry.q && entry.a)
    .slice(0, 50);
}

function clampInt(value: string, fallback: number, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export async function saveKnowledgeProfile(
  clientId: string,
  _previousState: FormState,
  formData: FormData,
): Promise<FormState> {
  const authState = await getAuthState();

  if (!authState.user) {
    return { status: "error", message: "Sign in to edit business knowledge." };
  }

  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() || null : null;
  };

  let faq = parseFaq(String(formData.get("faq") ?? ""));
  if (formData.has("faq_json")) {
    try {
      const entries: unknown = JSON.parse(String(formData.get("faq_json")));
      if (
        !Array.isArray(entries) ||
        entries.length > 50 ||
        entries.some(
          (entry) =>
            !entry ||
            typeof entry.q !== "string" ||
            typeof entry.a !== "string" ||
            !entry.q.trim() ||
            !entry.a.trim(),
        )
      ) {
        return {
          status: "error",
          message:
            "Add a question and answer to each entry. You can save up to 50 questions.",
        };
      }
      faq = entries.map((entry) => ({ q: entry.q.trim(), a: entry.a.trim() }));
    } catch {
      return {
        status: "error",
        message: "The questions could not be read. Refresh and try again.",
      };
    }
  }

  const disclosureMode = String(
    formData.get("voice_disclosure_mode") ?? "explicit",
  );

  if (!DISCLOSURE_MODES.includes(disclosureMode as never)) {
    return { status: "error", message: "Choose a valid disclosure mode." };
  }

  const bookingStart = clampInt(
    String(formData.get("booking_hours_start") ?? ""),
    9,
    0,
    23,
  );
  const bookingEnd = clampInt(
    String(formData.get("booking_hours_end") ?? ""),
    17,
    1,
    24,
  );

  if (bookingEnd <= bookingStart) {
    return {
      status: "error",
      message: "The booking window must end after it starts.",
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

    const row = {
      partner_id: access.partnerId,
      client_id: clientId,
      business_description: text("business_description"),
      services_offered: text("services_offered"),
      service_areas: text("service_areas"),
      business_hours: text("business_hours"),
      booking_hours_start: bookingStart,
      booking_hours_end: bookingEnd,
      appointment_duration_minutes: clampInt(
        String(formData.get("appointment_duration_minutes") ?? ""),
        60,
        15,
        480,
      ),
      emergency_rules: text("emergency_rules"),
      pricing_disclaimer: text("pricing_disclaimer"),
      booking_rules: text("booking_rules"),
      faq,
      escalation_rules: text("escalation_rules"),
      ai_disclosure: text("ai_disclosure"),
      voice_disclosure_mode: disclosureMode,
      updated_by: access.userId,
    };

    const { error } = await supabase
      .from("client_knowledge_profiles")
      .upsert(row, { onConflict: "client_id" });

    if (error) {
      return {
        status: "error",
        message: "The knowledge profile could not be saved. Try again.",
      };
    }

    await recordAuditEvent({
      actor: access,
      action: "knowledge.updated",
      targetType: "client_knowledge_profile",
      targetId: clientId,
      summary:
        "Updated the approved AI business knowledge. Assistants use only this content going forward.",
      afterSnapshot: {
        fields_set: Object.entries(row)
          .filter(([key, value]) => typeof value === "string" && value)
          .map(([key]) => key),
        faq_count: row.faq.length,
        voice_disclosure_mode: disclosureMode,
        booking_window: `${bookingStart}:00-${bookingEnd}:00`,
      },
    });

    revalidatePath(`/partner/clients/${clientId}/knowledge`);

    return {
      status: "success",
      message:
        "Knowledge saved. Chat, drafting, and voice assistants now use this approved content only.",
    };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        status: "error",
        message:
          error.code === "ACCESS_DENIED"
            ? "You do not have permission to edit knowledge for this client."
            : "Knowledge editing is unavailable right now.",
      };
    }

    throw error;
  }
}
