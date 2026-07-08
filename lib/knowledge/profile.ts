import type { SupabaseClient } from "@supabase/supabase-js";

// Approved business knowledge for AI assistants. This is the ONLY business
// information prompts may rely on: the guardrail block below is prepended
// wherever the knowledge is used so the model never invents services,
// pricing, guarantees, or availability.

export type FaqEntry = { q: string; a: string };

export type KnowledgeProfile = {
  id: string;
  partner_id: string;
  client_id: string;
  business_description: string | null;
  services_offered: string | null;
  service_areas: string | null;
  business_hours: string | null;
  booking_hours_start: number;
  booking_hours_end: number;
  appointment_duration_minutes: number;
  emergency_rules: string | null;
  pricing_disclaimer: string | null;
  booking_rules: string | null;
  faq: FaqEntry[];
  escalation_rules: string | null;
  ai_disclosure: string | null;
  voice_disclosure_mode: "off" | "explicit" | "minimal";
};

export async function getKnowledgeProfile(
  supabase: SupabaseClient,
  clientId: string,
): Promise<KnowledgeProfile | null> {
  const { data } = await supabase
    .from("client_knowledge_profiles")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!data) {
    return null;
  }

  return {
    ...data,
    faq: Array.isArray(data.faq)
      ? (data.faq as FaqEntry[]).filter((entry) => entry?.q && entry?.a)
      : [],
  } as KnowledgeProfile;
}

export const KNOWLEDGE_GUARDRAILS = `Hard rules about business knowledge:
- Use ONLY the approved business knowledge below. If something is not in it, say you will have the team confirm — never guess.
- Never invent services, service areas, pricing, discounts, guarantees, timelines, or availability.
- Never promise a price; use the pricing disclaimer if pricing comes up.
- Follow the emergency and escalation rules exactly when they apply.`;

export function buildKnowledgeBlock(
  clientName: string,
  profile: KnowledgeProfile | null,
): string {
  if (!profile) {
    return `Approved business knowledge for ${clientName}: none provided yet. Answer only questions about scheduling a visit or taking contact details; say the team will confirm everything else.`;
  }

  const lines: string[] = [`Approved business knowledge for ${clientName}:`];

  const push = (label: string, value: string | null) => {
    if (value?.trim()) {
      lines.push(`${label}: ${value.trim()}`);
    }
  };

  push("About the business", profile.business_description);
  push("Services offered", profile.services_offered);
  push("Service areas", profile.service_areas);
  push("Business hours", profile.business_hours);
  push("Emergency rules", profile.emergency_rules);
  push("Pricing disclaimer", profile.pricing_disclaimer);
  push("Booking rules", profile.booking_rules);
  push("Escalation rules", profile.escalation_rules);

  if (profile.faq.length > 0) {
    lines.push("Approved FAQ:");

    for (const entry of profile.faq.slice(0, 20)) {
      lines.push(`Q: ${entry.q}\nA: ${entry.a}`);
    }
  }

  return lines.join("\n");
}
