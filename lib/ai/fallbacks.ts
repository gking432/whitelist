import type { CustomerDraft, LeadIntakeAnalysis } from "@/lib/ai/schemas";

// Deterministic fallbacks. Used when the AI provider is not configured or a
// call fails, so workflow runs always complete with output the partner can
// act on. Output produced here is labeled status: "fallback" — rule-based,
// never presented as model output.

const DEFAULT_URGENCY_KEYWORDS = [
  "emergency",
  "urgent",
  "asap",
  "leak",
  "leaking",
  "flood",
  "storm",
  "damage",
  "no heat",
  "no ac",
  "no power",
  "burst",
  "sewage",
];

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function fallbackLeadIntakeAnalysis(args: {
  eventType: string;
  data: Record<string, unknown>;
  urgencyKeywords?: string[];
}): LeadIntakeAnalysis {
  const name =
    asString(args.data.name) || asString(args.data.full_name) || "";
  const phone = asString(args.data.phone);
  const email = asString(args.data.email);
  const serviceType = asString(args.data.service_type) || "not specified";
  const message = asString(args.data.message) || asString(args.data.description);

  const keywords =
    args.urgencyKeywords && args.urgencyKeywords.length > 0
      ? args.urgencyKeywords
      : DEFAULT_URGENCY_KEYWORDS;
  const haystack = `${message} ${serviceType}`.toLowerCase();
  const matched = keywords.filter((keyword) =>
    haystack.includes(keyword.toLowerCase()),
  );

  const isMissedCall = args.eventType.includes("call");
  const urgency: LeadIntakeAnalysis["urgency"] =
    matched.length > 0 ? "high" : isMissedCall ? "medium" : "medium";

  const missing: string[] = [];
  if (!name) missing.push("name");
  if (!phone) missing.push("phone");
  if (!email) missing.push("email");
  if (serviceType === "not specified") missing.push("service_type");

  const quality: LeadIntakeAnalysis["lead_quality"] =
    matched.length > 0 ? "hot" : missing.length >= 3 ? "cold" : "warm";

  const contactWindow =
    urgency === "high" ? "Within 1 hour" : "Same business day";
  const who = name || phone || email || "the new lead";

  return {
    summary: `Inbound ${args.eventType} event${name ? ` from ${name}` : ""}. ${
      matched.length > 0
        ? `Urgency keywords matched: ${matched.join(", ")}. `
        : ""
    }${message ? message.slice(0, 200) : "No message details were provided."}`,
    service_type: serviceType,
    urgency,
    urgency_reasoning:
      matched.length > 0
        ? `Rule-based keyword match: ${matched.join(", ")}.`
        : "No urgency keywords matched; classified by event type.",
    lead_quality: quality,
    lead_quality_reasoning:
      "Rule-based estimate from urgency signals and field completeness.",
    missing_fields: missing,
    recommended_next_action: `Contact ${who} ${contactWindow.toLowerCase()} to confirm project details${
      missing.length > 0 ? ` and collect: ${missing.join(", ")}` : ""
    }.`,
    recommended_contact_window: contactWindow,
    suggested_task: {
      title: `Follow up with ${who}`,
      description: `Inbound ${args.eventType} event. Confirm the service need and offer the next available appointment.`,
      priority: urgency === "high" ? "urgent" : "medium",
      due_in_minutes: urgency === "high" ? 30 : 240,
    },
    tags: [
      args.eventType,
      ...(matched.length > 0 ? ["urgency_keywords"] : []),
    ],
  };
}

export function fallbackCustomerDraft(args: {
  draftKind:
    | "missed_call_rescue"
    | "estimate_follow_up"
    | "appointment_confirmation"
    | "review_request";
  businessName: string;
  data: Record<string, unknown>;
  customTemplate?: string;
}): CustomerDraft {
  const name = asString(args.data.name) || asString(args.data.full_name);
  const phone = asString(args.data.phone);
  const email = asString(args.data.email);
  const greetingName = name || "there";
  const channel: CustomerDraft["channel"] = phone || !email ? "sms" : "email";
  const appointmentTime = asString(args.data.appointment_time);

  const internalNote =
    "Rule-based template draft (AI unavailable). Review and personalize before approving.";

  if (args.customTemplate) {
    const body = args.customTemplate
      .replaceAll("{{name}}", greetingName)
      .replaceAll("{{business}}", args.businessName)
      .replaceAll(
        "{{appointment_time}}",
        appointmentTime ? ` on ${appointmentTime}` : "",
      );

    return { channel, subject: null, body, internal_note: internalNote };
  }

  switch (args.draftKind) {
    case "missed_call_rescue":
      return {
        channel,
        subject: null,
        body: `Hi ${greetingName}, this is ${args.businessName}. Sorry we missed your call — how can we help? Reply here or let us know a good time to call you back.`,
        internal_note: internalNote,
      };
    case "estimate_follow_up":
      return {
        channel,
        subject:
          channel === "email" ? `Following up on your estimate` : null,
        body: `Hi ${greetingName}, following up from ${args.businessName} on the estimate we sent. Happy to answer any questions — is there anything holding you back?`,
        internal_note: internalNote,
      };
    case "appointment_confirmation":
      return {
        channel,
        subject:
          channel === "email"
            ? `Your appointment with ${args.businessName}`
            : null,
        body: `Hi ${greetingName}, a reminder from ${args.businessName} about your appointment${
          appointmentTime ? ` on ${appointmentTime}` : " coming up"
        }. Reply if you need to reschedule.`,
        internal_note: internalNote,
      };
    case "review_request":
      return {
        channel,
        subject: channel === "email" ? `Thanks from ${args.businessName}` : null,
        body: `Hi ${greetingName}, thanks for choosing ${args.businessName}! If you were happy with the work, would you mind leaving us a quick review?`,
        internal_note: internalNote,
      };
  }
}
