export const SCENARIO_LAB_CLIENT_SLUG = "northstar-scenario-lab";

export const LAB_FIELD_KEYS = [
  "name",
  "phone",
  "email",
  "address",
  "message",
  "appointment_preference",
  "appointment_time",
  "estimate_amount",
  "provider",
  "error_message",
] as const;

export type LabFieldKey = (typeof LAB_FIELD_KEYS)[number];

export type LabScenarioField = {
  key: LabFieldKey;
  label: string;
  type: "text" | "textarea" | "select";
  placeholder?: string;
  options?: { label: string; value: string }[];
};

export type LabScenarioExpectation = {
  templates: string[];
  minimumApprovals: number;
  recordsContact: boolean;
  bookingProposal?: boolean;
  routingCategory?: string;
  urgency?: "emergency" | "high" | "medium" | "low";
};

export type LabScenarioDefinition = {
  key:
    | "website_lead"
    | "urgent_lead"
    | "missed_call"
    | "inbound_sms"
    | "phone_transcript"
    | "scheduling_request"
    | "estimate_follow_up"
    | "appointment_reminder"
    | "job_completed"
    | "external_automation"
    | "provider_failure";
  title: string;
  description: string;
  kind: "event" | "phone_transcript";
  eventType: string;
  fields: LabScenarioField[];
  defaults: Partial<Record<LabFieldKey, string>>;
  staticData: Record<string, string | boolean>;
  expectation: LabScenarioExpectation;
  simulateCalendar?: boolean;
};

const CONTACT_FIELDS: LabScenarioField[] = [
  { key: "name", label: "Customer name", type: "text" },
  { key: "phone", label: "Phone", type: "text" },
  { key: "email", label: "Email", type: "text" },
  { key: "address", label: "Address", type: "text" },
];

const MESSAGE_FIELD: LabScenarioField = {
  key: "message",
  label: "Customer message",
  type: "textarea",
};

const BASE_CONTACT = {
  name: "Jordan Test",
  phone: "+15550100999",
  email: "jordan.test@northstar-lab.local",
  address: "410 Scenario Avenue",
};

export const LAB_SCENARIOS: LabScenarioDefinition[] = [
  {
    key: "website_lead",
    title: "Website lead",
    description: "Form submission through intake, AI routing, approval, and CRM.",
    kind: "event",
    eventType: "form.submitted",
    fields: [...CONTACT_FIELDS, MESSAGE_FIELD],
    defaults: {
      ...BASE_CONTACT,
      message:
        "I need a quote for replacing my water heater. Please call me this afternoon.",
    },
    staticData: { channel: "website", service_type: "Water heater replacement" },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 1,
      recordsContact: true,
    },
  },
  {
    key: "urgent_lead",
    title: "Urgent after-hours lead",
    description: "Emergency wording should route to a human with high urgency.",
    kind: "event",
    eventType: "form.submitted",
    fields: [...CONTACT_FIELDS, MESSAGE_FIELD],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100998",
      message:
        "Emergency: a pipe burst and water is flooding the basement. We need help ASAP.",
    },
    staticData: { channel: "website", after_hours: true },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 1,
      recordsContact: true,
      routingCategory: "urgent_emergency",
      urgency: "high",
    },
  },
  {
    key: "missed_call",
    title: "Missed call",
    description: "Missed-call rescue draft plus lead analysis and CRM recording.",
    kind: "event",
    eventType: "missed_call.created",
    fields: [...CONTACT_FIELDS, MESSAGE_FIELD],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100997",
      message:
        "Voicemail: our furnace stopped working and the house is getting cold.",
    },
    staticData: { channel: "phone", call_status: "missed" },
    expectation: {
      templates: [
        "new_lead_intake",
        "missed_call_rescue",
        "ai_intake_router",
      ],
      minimumApprovals: 1,
      recordsContact: true,
    },
  },
  {
    key: "inbound_sms",
    title: "Inbound SMS",
    description: "Text classification, response drafting, approval, and CRM.",
    kind: "event",
    eventType: "sms.received",
    fields: [CONTACT_FIELDS[0], CONTACT_FIELDS[1], MESSAGE_FIELD],
    defaults: {
      name: "Taylor Text",
      phone: "+15550100996",
      message: "Can I get an appointment to have my AC checked this week?",
    },
    staticData: { channel: "sms" },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 1,
      recordsContact: true,
      routingCategory: "scheduling",
    },
  },
  {
    key: "phone_transcript",
    title: "Completed phone call",
    description: "Transcript, call summary, popup events, lead pipeline, and CRM.",
    kind: "phone_transcript",
    eventType: "call.completed",
    fields: [CONTACT_FIELDS[1], MESSAGE_FIELD],
    defaults: {
      phone: "+15550100995",
      message:
        "Hi, this is Casey. Our kitchen sink is leaking and I would like someone to come Friday morning. My address is 82 Lake Street.",
    },
    staticData: { channel: "phone" },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 0,
      recordsContact: true,
    },
  },
  {
    key: "scheduling_request",
    title: "Lead-to-booking",
    description: "Lead response plus simulated availability and booking proposal.",
    kind: "event",
    eventType: "form.submitted",
    fields: [
      ...CONTACT_FIELDS,
      MESSAGE_FIELD,
      {
        key: "appointment_preference",
        label: "Appointment preference",
        type: "text",
      },
    ],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100994",
      message: "I would like to book an appointment for an AC tune-up.",
      appointment_preference: "Friday morning, but not tomorrow",
    },
    staticData: { channel: "website", service_type: "AC tune-up" },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 2,
      recordsContact: true,
      bookingProposal: true,
      routingCategory: "scheduling",
    },
    simulateCalendar: true,
  },
  {
    key: "estimate_follow_up",
    title: "Estimate follow-up",
    description: "Follow-up draft from an aging estimate event.",
    kind: "event",
    eventType: "estimate.follow_up_due",
    fields: [
      ...CONTACT_FIELDS,
      {
        key: "estimate_amount",
        label: "Estimate amount",
        type: "text",
      },
      MESSAGE_FIELD,
    ],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100993",
      estimate_amount: "2450",
      message: "Estimate sent five days ago for a new water heater.",
    },
    staticData: { channel: "crm", estimate_status: "sent" },
    expectation: {
      templates: ["estimate_follow_up"],
      minimumApprovals: 1,
      recordsContact: true,
    },
  },
  {
    key: "appointment_reminder",
    title: "Appointment reminder",
    description: "Reminder draft for an upcoming appointment.",
    kind: "event",
    eventType: "appointment.reminder_due",
    fields: [
      ...CONTACT_FIELDS,
      {
        key: "appointment_time",
        label: "Appointment time",
        type: "text",
      },
    ],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100992",
      appointment_time: "Tomorrow at 9:00 AM",
    },
    staticData: { channel: "calendar" },
    expectation: {
      templates: ["appointment_reminder"],
      minimumApprovals: 1,
      recordsContact: false,
    },
  },
  {
    key: "job_completed",
    title: "Job completed",
    description: "Review request after a completed service job.",
    kind: "event",
    eventType: "job.completed",
    fields: [...CONTACT_FIELDS, MESSAGE_FIELD],
    defaults: {
      ...BASE_CONTACT,
      phone: "+15550100991",
      message: "Water heater replacement completed successfully.",
    },
    staticData: { channel: "field_service", job_status: "completed" },
    expectation: {
      templates: ["review_request"],
      minimumApprovals: 1,
      recordsContact: false,
    },
  },
  {
    key: "external_automation",
    title: "Zapier / n8n / Make intake",
    description: "Partner-built automation delivering a normalized lead event.",
    kind: "event",
    eventType: "form.submitted",
    fields: [
      {
        key: "provider",
        label: "Automation provider",
        type: "select",
        options: [
          { label: "Zapier", value: "zapier" },
          { label: "n8n", value: "n8n" },
          { label: "Make", value: "make" },
        ],
      },
      ...CONTACT_FIELDS,
      MESSAGE_FIELD,
    ],
    defaults: {
      provider: "zapier",
      ...BASE_CONTACT,
      phone: "+15550100990",
      message: "Facebook lead requesting a roofing inspection and quote.",
    },
    staticData: { channel: "external_automation", external_event: true },
    expectation: {
      templates: ["new_lead_intake", "ai_intake_router"],
      minimumApprovals: 1,
      recordsContact: true,
    },
  },
  {
    key: "provider_failure",
    title: "Provider failure",
    description: "Failure event should create a visible systems run without sending.",
    kind: "event",
    eventType: "sync.failed",
    fields: [
      {
        key: "provider",
        label: "Provider",
        type: "select",
        options: [
          { label: "HubSpot", value: "hubspot" },
          { label: "Twilio", value: "twilio" },
          { label: "Zapier", value: "zapier" },
          { label: "n8n", value: "n8n" },
          { label: "Make", value: "make" },
        ],
      },
      {
        key: "error_message",
        label: "Failure detail",
        type: "textarea",
      },
    ],
    defaults: {
      provider: "hubspot",
      error_message: "Simulated provider timeout after three attempts.",
    },
    staticData: { channel: "system" },
    expectation: {
      templates: ["sync_failure_alert"],
      minimumApprovals: 0,
      recordsContact: false,
    },
  },
];

export type LabScenarioKey = (typeof LAB_SCENARIOS)[number]["key"];

export type LabScenarioValues = Partial<Record<LabFieldKey, string>>;

export function getLabScenario(
  key: string,
): LabScenarioDefinition | undefined {
  return LAB_SCENARIOS.find((scenario) => scenario.key === key);
}

export function sanitizeLabValues(
  scenario: LabScenarioDefinition,
  input: LabScenarioValues,
): LabScenarioValues {
  const allowed = new Set(scenario.fields.map((field) => field.key));
  const sanitized: LabScenarioValues = {};

  for (const key of LAB_FIELD_KEYS) {
    if (!allowed.has(key)) {
      continue;
    }

    const value = input[key];

    if (typeof value === "string") {
      sanitized[key] = value.trim().slice(0, key === "message" ? 4000 : 500);
    }
  }

  return sanitized;
}
