export const AUTOMATION_PLATFORM_KEYS = [
  "northstar",
  "zapier",
  "n8n",
  "make",
] as const;

export type AutomationPlatformKey =
  (typeof AUTOMATION_PLATFORM_KEYS)[number];

export type AutomationPackCategory =
  | "Lead response"
  | "Communications"
  | "Scheduling"
  | "Sales"
  | "Reputation"
  | "Finance"
  | "Marketing"
  | "Operations"
  | "Systems";

export type AutomationConnectionRequirement = {
  key:
    | "lead_source"
    | "customer_messaging"
    | "phone"
    | "calendar"
    | "crm"
    | "accounting"
    | "ads"
    | "file_storage"
    | "team_notifications";
  label: string;
  purpose: string;
  categories?: string[];
  providerKeys?: string[];
  supportsInbound?: boolean;
};

export type AutomationPack = {
  key: string;
  version: number;
  priority: number;
  name: string;
  category: AutomationPackCategory;
  description: string;
  eventType: string;
  eventTypes: string[];
  verificationEventTypes: string[];
  workflowTemplates: string[];
  outcome: string;
  requiredFields: string[];
  optionalFields: string[];
  connectionRequirements: AutomationConnectionRequirement[];
  platforms: AutomationPlatformKey[];
  layer: "native" | "hybrid" | "workflow";
  staffRuntime: "none" | "northstar_desktop";
  launchScope: "v1" | "next";
  testInstructions: string[];
};

const leadSource: AutomationConnectionRequirement = {
  key: "lead_source",
  label: "Lead source",
  purpose: "Receive a real lead, form, message, or source-system event.",
  supportsInbound: true,
};

const customerMessaging: AutomationConnectionRequirement = {
  key: "customer_messaging",
  label: "Customer messaging",
  purpose: "Send approved customer SMS or email messages.",
  categories: ["sms", "email"],
  providerKeys: ["twilio", "resend"],
};

const phone: AutomationConnectionRequirement = {
  key: "phone",
  label: "Phone system",
  purpose: "Receive call events, audio, caller identity, and call status.",
  categories: ["phone"],
  providerKeys: ["twilio"],
};

const calendar: AutomationConnectionRequirement = {
  key: "calendar",
  label: "Calendar",
  purpose: "Read real availability and create appointments.",
  categories: ["calendar"],
};

const crm: AutomationConnectionRequirement = {
  key: "crm",
  label: "CRM",
  purpose: "Find or create the customer and record the automation result.",
  categories: ["crm"],
};

const accounting: AutomationConnectionRequirement = {
  key: "accounting",
  label: "Accounting system",
  purpose: "Receive invoice and payment events.",
  categories: ["accounting"],
};

const ads: AutomationConnectionRequirement = {
  key: "ads",
  label: "Advertising account",
  purpose: "Report qualified leads and booked revenue as conversions.",
  categories: ["ads", "marketing"],
};

const fileStorage: AutomationConnectionRequirement = {
  key: "file_storage",
  label: "Job file destination",
  purpose: "Store photos, documents, recordings, and job attachments.",
  categories: ["file_storage"],
};

const teamNotifications: AutomationConnectionRequirement = {
  key: "team_notifications",
  label: "Team notifications",
  purpose: "Deliver internal alerts and owner summaries.",
  categories: ["team_notifications", "email"],
  providerKeys: ["resend"],
};

export const AUTOMATION_PACKS: AutomationPack[] = [
  {
    key: "universal-lead-capture",
    version: 1,
    priority: 1,
    name: "Universal Lead Capture",
    category: "Lead response",
    description:
      "Turns forms, ads, chat, email, and external CRM events into one normalized customer and lead record.",
    eventType: "form.submitted",
    eventTypes: [
      "lead.created",
      "form.submitted",
      "email.lead_received",
      "chat.conversation_completed",
      "gbp.message_received",
      "manual.lead_created",
    ],
    verificationEventTypes: [
      "lead.created",
      "form.submitted",
      "email.lead_received",
      "chat.conversation_completed",
      "gbp.message_received",
    ],
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Matched or created contact, lead, urgency, routing decision, CRM timeline entry, and follow-up task.",
    requiredFields: ["name", "phone or email", "message"],
    optionalFields: ["address", "service_type", "source", "campaign"],
    connectionRequirements: [leadSource],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "v1",
    testInstructions: [
      "Submit a real test lead through the connected form, ad, chat, or source system.",
      "Confirm the customer and lead appear in the selected CRM.",
      "Verify the processed event and workflow runs here.",
    ],
  },
  {
    key: "speed-to-lead",
    version: 1,
    priority: 2,
    name: "Speed-to-Lead",
    category: "Lead response",
    description:
      "Classifies a fresh lead, assigns the next action, and prepares an immediate first response.",
    eventType: "lead.created",
    eventTypes: ["lead.created", "form.submitted", "email.lead_received"],
    verificationEventTypes: [
      "lead.created",
      "form.submitted",
      "email.lead_received",
    ],
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "AI analysis, owner routing, response task, CRM note, and approval-gated SMS or email draft.",
    requiredFields: ["name", "phone or email", "message"],
    optionalFields: ["address", "service_type", "appointment_preference"],
    connectionRequirements: [leadSource, customerMessaging],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "v1",
    testInstructions: [
      "Submit a real lead with a reachable test phone number or email.",
      "Open the client approval queue and review the generated first response.",
      "Approve it and confirm delivery through the connected provider.",
    ],
  },
  {
    key: "missed-call-rescue",
    version: 1,
    priority: 3,
    name: "Missed-Call Rescue",
    category: "Communications",
    description:
      "Turns an unanswered call or voicemail into a customer record, callback task, and personalized follow-up.",
    eventType: "call.missed",
    eventTypes: ["call.missed", "missed_call.created"],
    verificationEventTypes: ["call.missed", "missed_call.created"],
    workflowTemplates: ["missed_call_rescue", "ai_intake_router"],
    outcome:
      "Matched or created contact, voicemail analysis, urgent callback task, CRM note, and approval-gated SMS.",
    requiredFields: ["phone"],
    optionalFields: ["name", "voicemail", "call_time", "after_hours"],
    connectionRequirements: [phone, customerMessaging, crm],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "v1",
    testInstructions: [
      "Call the connected business number and let the call go unanswered.",
      "Confirm the caller appears in the CRM with a callback task.",
      "Review and send the missed-call response from the client approval queue.",
    ],
  },
  {
    key: "ai-phone-answering",
    version: 1,
    priority: 4,
    name: "AI Phone Answering",
    category: "Communications",
    description:
      "Answers a real call, identifies the customer, captures the service need, handles scheduling, and records the result.",
    eventType: "call.completed",
    eventTypes: ["call.started", "call.completed"],
    verificationEventTypes: ["call.completed"],
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Caller match, structured intake, transcript, summary, CRM note, scheduling request, and follow-up work.",
    requiredFields: ["phone", "transcript"],
    optionalFields: ["name", "email", "address", "appointment_preference"],
    connectionRequirements: [phone, calendar, crm],
    platforms: ["northstar"],
    layer: "native",
    staffRuntime: "none",
    launchScope: "v1",
    testInstructions: [
      "Call the connected business number from a test phone and speak with the AI assistant.",
      "Provide a name, service need, and scheduling preference before ending the call.",
      "Confirm the transcript, summary, CRM record, and proposed appointment appear.",
    ],
  },
  {
    key: "live-call-assistant",
    version: 1,
    priority: 5,
    name: "Live Call Assistant",
    category: "Communications",
    description:
      "Supports a staff-answered call with caller lookup, live notes, missing intake fields, and real calendar suggestions.",
    eventType: "call.completed",
    eventTypes: ["call.started", "call.completed"],
    verificationEventTypes: ["call.completed"],
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Desktop popup, matched customer, live transcript, intake prompts, appointment options, call summary, and CRM note.",
    requiredFields: ["phone", "transcript"],
    optionalFields: ["name", "email", "address", "appointment_preference"],
    connectionRequirements: [phone, calendar, crm],
    platforms: ["northstar"],
    layer: "native",
    staffRuntime: "northstar_desktop",
    launchScope: "v1",
    testInstructions: [
      "Open the Northstar desktop assistant and call the connected business number.",
      "Answer as staff, then discuss a service need and possible appointment.",
      "Confirm the popup, live scheduling suggestions, summary, and CRM note.",
    ],
  },
  {
    key: "booking-confirmations",
    version: 1,
    priority: 6,
    name: "Booking + Confirmation",
    category: "Scheduling",
    description:
      "Checks real availability, proposes or creates the appointment, records it in the CRM, and prepares confirmation messages.",
    eventType: "appointment.requested",
    eventTypes: [
      "appointment.requested",
      "appointment.created",
      "appointment.booked",
    ],
    verificationEventTypes: ["appointment.created", "appointment.booked"],
    workflowTemplates: ["ai_intake_router", "appointment_reminder"],
    outcome:
      "Available slots, approval-gated booking, calendar event, CRM activity, and customer confirmation.",
    requiredFields: ["name", "phone or email", "appointment preference"],
    optionalFields: ["address", "service_type", "assigned_staff"],
    connectionRequirements: [calendar, crm, customerMessaging],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "v1",
    testInstructions: [
      "Request an appointment through a real connected lead or phone channel.",
      "Approve one of the suggested times from the client account.",
      "Confirm the event in the external calendar, CRM, and delivery log.",
    ],
  },
  {
    key: "appointment-reminders",
    version: 1,
    priority: 7,
    name: "Reminder + Rescheduling",
    category: "Scheduling",
    description:
      "Sends timed confirmations and reminders, accepts rescheduling requests, and starts no-show recovery.",
    eventType: "appointment.reminder_due",
    eventTypes: ["appointment.booked", "appointment.reminder_due", "appointment.no_show"],
    verificationEventTypes: ["appointment.reminder_due"],
    workflowTemplates: ["appointment_reminder"],
    outcome: "Reminder delivery, rescheduling path, CRM timeline entry, and no-show follow-up.",
    requiredFields: ["name", "phone or email", "appointment_time"],
    optionalFields: ["address", "assigned_staff", "service_type"],
    connectionRequirements: [calendar, customerMessaging],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Create a near-term test appointment.", "Confirm the reminder and rescheduling path.", "Verify the delivery log."],
  },
  {
    key: "estimate-follow-up",
    version: 1,
    priority: 8,
    name: "Estimate Follow-Up",
    category: "Sales",
    description: "Follows up when an estimate has gone quiet and creates a visible sales task.",
    eventType: "estimate.follow_up_due",
    eventTypes: ["estimate.sent", "estimate.follow_up_due", "estimate.accepted"],
    verificationEventTypes: ["estimate.follow_up_due"],
    workflowTemplates: ["estimate_follow_up"],
    outcome: "Personalized follow-up, approval item, sales task, and tracked response.",
    requiredFields: ["name", "phone or email"],
    optionalFields: ["estimate_amount", "estimate_date", "service_type", "sales_rep"],
    connectionRequirements: [crm, customerMessaging],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Create a test estimate.", "Mark it due for follow-up.", "Review the drafted message and sales task."],
  },
  {
    key: "review-request",
    version: 1,
    priority: 9,
    name: "Review + Referral Request",
    category: "Reputation",
    description: "Thanks customers after completed work and requests a review or referral through their preferred channel.",
    eventType: "job.completed",
    eventTypes: ["job.completed"],
    verificationEventTypes: ["job.completed"],
    workflowTemplates: ["review_request"],
    outcome: "Personalized request, approval item, delivery log, and CRM timeline contribution.",
    requiredFields: ["name", "phone or email"],
    optionalFields: ["service_type", "job_summary", "review_url", "technician"],
    connectionRequirements: [crm, customerMessaging],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Complete a test job.", "Review and approve the request.", "Confirm delivery and CRM history."],
  },
  {
    key: "invoice-payment-sync",
    version: 1,
    priority: 10,
    name: "Invoice + Payment Sync",
    category: "Finance",
    description: "Keeps invoice and payment status synchronized and identifies overdue follow-up work.",
    eventType: "invoice.created",
    eventTypes: ["invoice.created", "invoice.paid", "invoice.overdue"],
    verificationEventTypes: ["invoice.created", "invoice.paid"],
    workflowTemplates: [],
    outcome: "Current financial status, CRM activity, owner reporting, and overdue follow-up task.",
    requiredFields: ["customer", "invoice_id", "status"],
    optionalFields: ["amount", "due_date", "job_id"],
    connectionRequirements: [accounting, crm],
    platforms: ["zapier", "n8n", "make"],
    layer: "workflow",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Create a test invoice.", "Record a test payment.", "Verify both status changes in Northstar."],
  },
  {
    key: "marketing-attribution",
    version: 1,
    priority: 11,
    name: "Marketing Attribution",
    category: "Marketing",
    description: "Reports qualified leads, booked jobs, and revenue back to advertising platforms as conversions.",
    eventType: "appointment.booked",
    eventTypes: ["lead.qualified", "appointment.booked", "job.completed", "invoice.paid"],
    verificationEventTypes: ["lead.qualified", "appointment.booked", "job.completed"],
    workflowTemplates: [],
    outcome: "Offline conversion, campaign attribution, revenue reporting, and deduplicated source history.",
    requiredFields: ["conversion_type", "occurred_at", "source identifier"],
    optionalFields: ["value", "currency", "campaign", "click_id"],
    connectionRequirements: [crm, ads],
    platforms: ["zapier", "n8n", "make"],
    layer: "workflow",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Create a test attributed lead.", "Advance it to a conversion.", "Confirm the external ads conversion and Northstar log."],
  },
  {
    key: "owner-digest",
    version: 1,
    priority: 12,
    name: "Owner Digest + Failure Alerts",
    category: "Systems",
    description: "Summarizes daily results and immediately reports failed phone, CRM, calendar, or messaging connections.",
    eventType: "sync.failed",
    eventTypes: ["digest.daily_due", "sync.failed"],
    verificationEventTypes: ["digest.sent", "sync.failed"],
    workflowTemplates: ["sync_failure_alert"],
    outcome: "Daily operating summary, immediate failure alert, health status, and troubleshooting context.",
    requiredFields: ["recipient"],
    optionalFields: ["delivery_channel", "quiet_hours", "included_metrics"],
    connectionRequirements: [teamNotifications],
    platforms: ["northstar", "zapier", "n8n", "make"],
    layer: "hybrid",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Run a connection check.", "Generate the owner digest.", "Confirm delivery and failure detail."],
  },
  {
    key: "customer-reactivation",
    version: 1,
    priority: 13,
    name: "Customer Reactivation",
    category: "Marketing",
    description: "Finds inactive customers and runs a controlled, deduplicated win-back sequence.",
    eventType: "customer.reactivation_due",
    eventTypes: ["customer.reactivation_due"],
    verificationEventTypes: ["customer.reactivation_due"],
    workflowTemplates: [],
    outcome: "Eligible audience, personalized campaign, suppression checks, tracked replies, and rebooked revenue.",
    requiredFields: ["customer", "last_service_date"],
    optionalFields: ["service_type", "offer", "campaign_window"],
    connectionRequirements: [crm, customerMessaging],
    platforms: ["zapier", "n8n", "make"],
    layer: "workflow",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Add a test inactive customer.", "Run the eligible-audience preview.", "Approve and verify one campaign delivery."],
  },
  {
    key: "job-files",
    version: 1,
    priority: 14,
    name: "Job Photos + Documents",
    category: "Operations",
    description: "Moves job photos, forms, recordings, and attachments into the correct customer and job record.",
    eventType: "job.file_created",
    eventTypes: ["job.file_created", "call.recording_ready", "form.completed"],
    verificationEventTypes: ["job.file_created", "call.recording_ready"],
    workflowTemplates: [],
    outcome: "Named and organized file, linked CRM/job record, source metadata, and visible transfer status.",
    requiredFields: ["file", "customer or job identifier"],
    optionalFields: ["file_type", "technician", "captured_at"],
    connectionRequirements: [crm, fileStorage],
    platforms: ["zapier", "n8n", "make"],
    layer: "workflow",
    staffRuntime: "none",
    launchScope: "next",
    testInstructions: ["Attach a test photo or file to a job.", "Confirm the destination and naming.", "Verify the transfer log."],
  },
];

export const V1_AUTOMATION_PACKS = AUTOMATION_PACKS.filter(
  (pack) => pack.launchScope === "v1",
);

export function getAutomationPack(key: string): AutomationPack | null {
  return AUTOMATION_PACKS.find((pack) => pack.key === key) ?? null;
}

export function northstarEventEnvelope(
  pack: AutomationPack,
): Record<string, unknown> {
  return {
    event_type: pack.eventType,
    event_version: "1.0",
    idempotency_key: `{{source_id}}-${pack.key}`,
    occurred_at: "{{timestamp}}",
    source: "{{source_app}}",
    data: {
      name: "{{customer_name}}",
      phone: "{{customer_phone}}",
      email: "{{customer_email}}",
      address: "{{service_address}}",
      message: "{{message_or_notes}}",
      service_type: "{{service_type}}",
    },
  };
}
