// Template-specific run logic. Handlers are pure: they receive the trigger
// payload plus instance settings and return steps, output, and an optional
// approval draft. All drafts are rule-based template text — no external
// model calls happen in this release.

export type RunStep = {
  name: string;
  detail: string;
};

export type ApprovalDraft = {
  type: string;
  title: string;
  summary: string;
  riskLevel: "low" | "medium" | "high";
  editableContent: string | null;
  proposedPayload: Record<string, unknown>;
};

export type HandlerResult = {
  steps: RunStep[];
  summary: string;
  output: Record<string, unknown>;
  approvalDraft?: ApprovalDraft;
};

export type HandlerContext = {
  eventType: string;
  data: Record<string, unknown>;
  settings: Record<string, unknown>;
  clientName: string;
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    return vars[key] ?? "";
  });
}

const DEFAULT_URGENCY_KEYWORDS = [
  "emergency",
  "urgent",
  "asap",
  "leak",
  "flood",
  "storm",
  "damage",
  "no heat",
  "no ac",
  "burst",
  "sewage",
];

function handleNewLeadIntake(context: HandlerContext): HandlerResult {
  const lead = {
    name: asString(context.data.name) || asString(context.data.full_name),
    email: asString(context.data.email),
    phone: asString(context.data.phone),
    service_type: asString(context.data.service_type),
    message: asString(context.data.message),
    source: asString(context.data.source),
  };

  const configuredKeywords = asString(context.settings.high_urgency_keywords);
  const keywords = configuredKeywords
    ? configuredKeywords
        .split(",")
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean)
    : DEFAULT_URGENCY_KEYWORDS;

  const haystack = `${lead.message} ${lead.service_type}`.toLowerCase();
  const matched = keywords.filter((keyword) => haystack.includes(keyword));
  const urgency = matched.length > 0 ? "high" : "normal";

  const missing = ["name", "email", "phone"].filter(
    (field) => !lead[field as keyof typeof lead],
  );

  return {
    steps: [
      { name: "Received event", detail: `Trigger: ${context.eventType}` },
      {
        name: "Normalized lead fields",
        detail:
          missing.length > 0
            ? `Missing fields: ${missing.join(", ")}`
            : "All primary contact fields present.",
      },
      {
        name: "Classified urgency (rule-based)",
        detail:
          matched.length > 0
            ? `Matched keywords: ${matched.join(", ")}`
            : "No urgency keywords matched.",
      },
    ],
    summary: `New lead${lead.name ? ` from ${lead.name}` : ""} classified as ${urgency} urgency.`,
    output: { lead, urgency, matched_keywords: matched },
  };
}

function draftMessageHandler(options: {
  approvalType: string;
  riskLevel: "low" | "medium" | "high";
  defaultTemplate: string;
  titlePrefix: string;
  extraVars?: (data: Record<string, unknown>) => Record<string, string>;
}) {
  return (context: HandlerContext): HandlerResult => {
    const name = asString(context.data.name) || asString(context.data.full_name);
    const phone = asString(context.data.phone);
    const email = asString(context.data.email);
    const recipient = name || phone || email || "the customer";

    const vars: Record<string, string> = {
      name: name || "there",
      business: context.clientName,
      ...(options.extraVars ? options.extraVars(context.data) : {}),
    };

    const template =
      asString(context.settings.message_template) || options.defaultTemplate;
    const draft = renderTemplate(template, vars);

    return {
      steps: [
        { name: "Received event", detail: `Trigger: ${context.eventType}` },
        {
          name: "Prepared message draft",
          detail: "Draft generated from the configured rule-based template.",
        },
        {
          name: "Queued for approval",
          detail: "Customer-facing drafts require human review before any send.",
        },
      ],
      summary: `${options.titlePrefix} draft prepared for ${recipient}.`,
      output: { draft, recipient: { name, phone, email } },
      approvalDraft: {
        type: options.approvalType,
        title: `${options.titlePrefix}: ${recipient}`,
        summary: `Review the drafted message to ${recipient} for ${context.clientName}.`,
        riskLevel: options.riskLevel,
        editableContent: draft,
        proposedPayload: {
          channel: phone ? "sms" : "email",
          to: phone || email || null,
          draft_source: "rule_based_template",
        },
      },
    };
  };
}

function handleSyncFailureAlert(context: HandlerContext): HandlerResult {
  const system = asString(context.data.system) || "external system";
  const detail =
    asString(context.data.error_message) ||
    asString(context.data.message) ||
    "No failure detail supplied.";

  return {
    steps: [
      { name: "Received event", detail: `Trigger: ${context.eventType}` },
      {
        name: "Recorded sync issue",
        detail: `Source: ${system}. ${detail}`,
      },
    ],
    summary: `Sync failure reported by ${system}.`,
    output: {
      issue: {
        system,
        detail,
        next_action:
          "Review the connection's recent events and the external system's sync configuration.",
      },
    },
  };
}

export const templateHandlers: Record<
  string,
  (context: HandlerContext) => HandlerResult
> = {
  new_lead_intake: handleNewLeadIntake,
  missed_call_rescue: draftMessageHandler({
    approvalType: "customer_message",
    riskLevel: "high",
    titlePrefix: "Missed-call follow-up",
    defaultTemplate:
      "Hi {{name}}, this is {{business}}. Sorry we missed your call — how can we help? Reply here or call us back anytime.",
  }),
  appointment_reminder: draftMessageHandler({
    approvalType: "customer_message",
    riskLevel: "medium",
    titlePrefix: "Appointment reminder",
    defaultTemplate:
      "Hi {{name}}, a reminder from {{business}} about your upcoming appointment{{appointment_time}}. Reply if you need to reschedule.",
    extraVars: (data) => {
      const time = typeof data.appointment_time === "string"
        ? data.appointment_time
        : "";

      return { appointment_time: time ? ` on ${time}` : "" };
    },
  }),
  estimate_follow_up: draftMessageHandler({
    approvalType: "customer_message",
    riskLevel: "high",
    titlePrefix: "Estimate follow-up",
    defaultTemplate:
      "Hi {{name}}, following up from {{business}} on the estimate we sent. Happy to answer any questions — is there anything holding you back?",
  }),
  review_request: draftMessageHandler({
    approvalType: "customer_message",
    riskLevel: "medium",
    titlePrefix: "Review request",
    defaultTemplate:
      "Hi {{name}}, thanks for choosing {{business}}! If you were happy with the work, would you mind leaving us a quick review?",
  }),
  sync_failure_alert: handleSyncFailureAlert,
};
