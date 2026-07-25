// Capability catalog for partner packages (docs/12 "Partner Package
// Builder"). A package is a set of plain toggles; each capability declares
// what it needs — integrations, workflow templates, and any software the
// client's staff must run — plus an honest status for what is real today.
// Adding a capability here needs no migration: packages store a plain
// capability_key -> boolean map.

export const CAPABILITY_KEYS = [
  "northstar_crm",
  "lead_intake",
  "crm_sync",
  "message_drafting",
  "approval_gated_sending",
  "ai_intake_routing",
  "quote_intelligence",
  "feedback_intelligence",
  "automation_packs",
  "website_ai_chat",
  "live_call_assistant",
  "live_scheduling_assistant",
  "ai_phone_answering",
  "appointment_booking",
  "review_requests",
  "reports_portal",
] as const;

export type CapabilityKey = (typeof CAPABILITY_KEYS)[number];

// How real the capability is in the current release. "available" works end
// to end today; "preview" has real plumbing but a missing final mile (the
// note says exactly what); "coming_soon" is sold-ahead roadmap and setup
// says so plainly.
export type CapabilityStatus = "available" | "preview" | "coming_soon";

// What client-side software (if any) staff need for this capability.
// Most capabilities need nothing installed — never assume a desktop app.
export type StaffRuntime =
  | "none"
  | "northstar_web"
  | "website_widget"
  | "browser_extension_or_desktop";

export const STAFF_RUNTIME_LABELS: Record<
  StaffRuntime,
  { label: string; detail: string }
> = {
  none: {
    label: "Nothing to install",
    detail: "Runs entirely in the background. Client staff install nothing.",
  },
  northstar_web: {
    label: "Northstar web approvals",
    detail:
      "Authorized client staff approve customer-facing messages in the Northstar web portal. Partners can inspect the decision history but cannot approve on the client's behalf. No install — just a browser login.",
  },
  website_widget: {
    label: "Website widget / snippet",
    detail:
      "A small widget or snippet goes on the client's website (or a hosted Northstar page is used instead). Nothing on staff computers.",
  },
  browser_extension_or_desktop: {
    label: "Browser extension or desktop popup app",
    detail:
      "Live on-call popups need a small runtime on the staff computers that take calls — a browser extension or tray app. Only needed for live call features, and not built yet.",
  },
};

// A concrete "connect this" requirement a capability adds to the setup
// checklist. Requirements with the same id are merged across capabilities.
export type IntegrationRequirement = {
  id: "lead_source" | "crm" | "sms" | "email" | "calendar" | "phone";
  label: string;
  // What Northstar does through it — plain language for the checklist.
  purpose: string;
  // Provider category to match against integration_connections (null for
  // lead_source, which matches any inbound-capable connection).
  category: "crm" | "sms" | "email" | "calendar" | "phone" | null;
  // True when a real connectable adapter exists in this release.
  connectableToday: boolean;
  recommended: string;
};

const REQUIREMENTS: Record<IntegrationRequirement["id"], IntegrationRequirement> =
  {
    lead_source: {
      id: "lead_source",
      label: "Lead source",
      purpose: "Receive this client's incoming leads (form, chat, webhook).",
      category: null,
      connectableToday: true,
      recommended: "Set up in the lead source section below.",
    },
    crm: {
      id: "crm",
      label: "CRM",
      purpose: "Keep contacts current and leave AI Assistant notes.",
      category: "crm",
      connectableToday: true,
      recommended:
        "HubSpot or GoHighLevel natively; any other system via the signed outbound webhook.",
    },
    sms: {
      id: "sms",
      label: "SMS provider",
      purpose: "Send the text messages a human approves.",
      category: "sms",
      connectableToday: true,
      recommended: "Twilio.",
    },
    email: {
      id: "email",
      label: "Email provider",
      purpose: "Send the emails a human approves.",
      category: "email",
      connectableToday: true,
      recommended: "Resend (free tier works).",
    },
    calendar: {
      id: "calendar",
      label: "Calendar",
      purpose: "Read availability and create booked appointments.",
      category: "calendar",
      connectableToday: true,
      recommended: "Google Calendar today; Outlook later.",
    },
    phone: {
      id: "phone",
      label: "Phone provider",
      purpose: "Answer, listen to, or follow up on real phone calls.",
      category: "phone",
      connectableToday: true,
      recommended:
        "Twilio Voice uses the same account and number as Northstar SMS.",
    },
  };

export type CapabilityMeta = {
  key: CapabilityKey;
  label: string;
  description: string;
  status: CapabilityStatus;
  // Honest one-liner for preview/coming_soon states.
  statusNote: string | null;
  requirements: IntegrationRequirement[];
  // workflow_templates.template_key values this capability turns on.
  workflowTemplateKeys: string[];
  staffRuntime: StaffRuntime;
};

export const CAPABILITIES: Record<CapabilityKey, CapabilityMeta> = {
  northstar_crm: {
    key: "northstar_crm",
    label: "Northstar CRM",
    description:
      "A complete built-in CRM with contacts, pipeline, tasks, inbox, schedule, calls, quotes, feedback, and reports for clients that need an operating system.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: [],
    staffRuntime: "northstar_web",
  },
  lead_intake: {
    key: "lead_intake",
    label: "Lead intake",
    description:
      "Incoming leads (forms, webhooks, manual entry) land in Northstar, get AI lead analysis, and trigger the lead response workflow.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.lead_source],
    workflowTemplateKeys: ["new_lead_intake"],
    staffRuntime: "none",
  },
  crm_sync: {
    key: "crm_sync",
    label: "CRM sync",
    description:
      "Contacts are created or updated in the client's CRM with an \"AI Assistant\" note after each lead. Additive-only: never deletes, never changes deal stages.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.crm],
    workflowTemplateKeys: ["sync_failure_alert"],
    staffRuntime: "none",
  },
  message_drafting: {
    key: "message_drafting",
    label: "SMS/email drafting",
    description:
      "AI drafts replies, follow-ups, and rescue messages for missed calls and estimates. Drafts wait for a human — nothing sends by itself.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: ["missed_call_rescue", "estimate_follow_up"],
    staffRuntime: "northstar_web",
  },
  approval_gated_sending: {
    key: "approval_gated_sending",
    label: "Approval-gated sending",
    description:
      "Approved drafts actually send through the connected provider (SMS via Twilio, email via Resend), and every send (or dry run) is logged.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.sms, REQUIREMENTS.email],
    workflowTemplateKeys: [],
    staffRuntime: "northstar_web",
  },
  ai_intake_routing: {
    key: "ai_intake_routing",
    label: "AI intake routing",
    description:
      "Every inbound interaction is classified (sales, service, scheduling, urgent, billing, spam…) so the right workflow and people see it.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.lead_source],
    workflowTemplateKeys: ["ai_intake_router"],
    staffRuntime: "none",
  },
  quote_intelligence: {
    key: "quote_intelligence",
    label: "AI quote assistant",
    description:
      "Creates transparent ballpark ranges from service type, labor, materials, complexity, and urgency, then records the quote in Northstar CRM.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: ["estimate_follow_up"],
    staffRuntime: "northstar_web",
  },
  feedback_intelligence: {
    key: "feedback_intelligence",
    label: "AI feedback intelligence",
    description:
      "Analyzes reviews and customer feedback for sentiment and risk, drafts a response, and opens a manager task when an issue needs attention.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: ["review_request"],
    staffRuntime: "northstar_web",
  },
  automation_packs: {
    key: "automation_packs",
    label: "Zapier, n8n & Make packs",
    description:
      "Client-ready automation recipes and downloadable templates connect external apps to Northstar's signed event and workflow system.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: [],
    staffRuntime: "none",
  },
  website_ai_chat: {
    key: "website_ai_chat",
    label: "Website AI chat",
    description:
      "A chat assistant on the client's website that answers questions, collects lead details, and hands off to a human.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.lead_source],
    workflowTemplateKeys: ["ai_intake_router"],
    staffRuntime: "website_widget",
  },
  live_call_assistant: {
    key: "live_call_assistant",
    label: "Live call assistant",
    description:
      "A popup that helps staff during an active call: caller match, extracted fields, missing questions, urgency flags.",
    status: "preview",
    statusNote:
      "The browser call lab, transcript, extracted fields, urgency flags, and CRM notes work now. A carrier connection is still needed for live external calls.",
    requirements: [REQUIREMENTS.phone],
    workflowTemplateKeys: [],
    staffRuntime: "northstar_web",
  },
  live_scheduling_assistant: {
    key: "live_scheduling_assistant",
    label: "Live scheduling assistant",
    description:
      "Suggests appointment slots during a call that fit the customer, the calendar, and service rules.",
    status: "preview",
    statusNote:
      "The scheduling popup works in the browser call lab with Northstar or Google availability. A carrier connection is still needed during real external calls.",
    requirements: [REQUIREMENTS.phone, REQUIREMENTS.calendar],
    workflowTemplateKeys: [],
    staffRuntime: "northstar_web",
  },
  ai_phone_answering: {
    key: "ai_phone_answering",
    label: "AI phone answering",
    description:
      "AI answers inbound calls and calls new leads back fast, with clear disclosure and human handoff.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.phone],
    workflowTemplateKeys: ["missed_call_rescue"],
    staffRuntime: "none",
  },
  appointment_booking: {
    key: "appointment_booking",
    label: "Appointment booking",
    description:
      "Northstar reads real calendar availability and books appointments, with reminder drafts before each visit.",
    status: "available",
    statusNote: null,
    requirements: [REQUIREMENTS.calendar],
    workflowTemplateKeys: ["appointment_reminder"],
    staffRuntime: "none",
  },
  review_requests: {
    key: "review_requests",
    label: "Review requests",
    description:
      "After a completed job, AI drafts a personal review request for approval and (if sending is enabled) delivery.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: ["review_request"],
    staffRuntime: "northstar_web",
  },
  reports_portal: {
    key: "reports_portal",
    label: "Reports & client portal",
    description:
      "The client owner gets a simple portal: activity, approvals, integration health, and value reports. Staff never need it.",
    status: "available",
    statusNote: null,
    requirements: [],
    workflowTemplateKeys: [],
    staffRuntime: "northstar_web",
  },
};

export function isCapabilityKey(value: string): value is CapabilityKey {
  return (CAPABILITY_KEYS as readonly string[]).includes(value);
}

// Normalizes a stored capabilities map to the known keys.
export function enabledCapabilityKeys(
  capabilities: Record<string, unknown> | null | undefined,
): CapabilityKey[] {
  if (!capabilities) {
    return [];
  }

  return CAPABILITY_KEYS.filter((key) => capabilities[key] === true);
}
