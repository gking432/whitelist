export type AutomationPack = {
  key: string;
  name: string;
  category:
    | "Lead response"
    | "Communications"
    | "Scheduling"
    | "Sales"
    | "Reputation"
    | "Systems";
  description: string;
  eventType: string;
  workflowTemplates: string[];
  outcome: string;
  requiredFields: string[];
  optionalFields: string[];
};

export const AUTOMATION_PACKS: AutomationPack[] = [
  {
    key: "speed-to-lead",
    name: "Speed-to-Lead",
    category: "Lead response",
    description:
      "Send a form, ad lead, or CRM contact into Northstar for AI analysis, routing, CRM recording, and a first-response draft.",
    eventType: "form.submitted",
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Lead, urgency score, routing decision, follow-up task, CRM note, and approval-gated reply.",
    requiredFields: ["name", "phone or email", "message"],
    optionalFields: ["address", "service_type", "source", "appointment_preference"],
  },
  {
    key: "missed-call-rescue",
    name: "Missed-Call Rescue",
    category: "Communications",
    description:
      "Turn a missed call or voicemail into a CRM lead, urgent task, and personalized SMS draft.",
    eventType: "missed_call.created",
    workflowTemplates: [
      "new_lead_intake",
      "missed_call_rescue",
      "ai_intake_router",
    ],
    outcome:
      "Matched or created contact, voicemail analysis, callback task, and approval-gated SMS.",
    requiredFields: ["phone"],
    optionalFields: ["name", "voicemail", "call_time", "after_hours"],
  },
  {
    key: "inbound-message",
    name: "Inbound SMS / Email",
    category: "Communications",
    description:
      "Route inbound customer messages, detect urgency and intent, update the CRM, and draft the right response.",
    eventType: "sms.received",
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Unified inbox message, route, CRM timeline entry, task, and approval-gated response.",
    requiredFields: ["phone or email", "message"],
    optionalFields: ["name", "subject", "channel"],
  },
  {
    key: "call-intelligence",
    name: "Call Intelligence + Scheduling",
    category: "Scheduling",
    description:
      "Send a completed transcript into call summarization, CRM notes, contact extraction, routing, and appointment handling.",
    eventType: "call.completed",
    workflowTemplates: ["new_lead_intake", "ai_intake_router"],
    outcome:
      "Transcript, summary, extracted fields, CRM note, suggested slots, booking request, and follow-up draft.",
    requiredFields: ["phone", "transcript"],
    optionalFields: ["name", "email", "address", "appointment_preference"],
  },
  {
    key: "estimate-follow-up",
    name: "Estimate Follow-Up",
    category: "Sales",
    description:
      "Follow up automatically when an estimate has gone quiet without sending an unapproved message.",
    eventType: "estimate.follow_up_due",
    workflowTemplates: ["estimate_follow_up"],
    outcome:
      "Personalized SMS or email draft, approval request, and visible sales follow-up task.",
    requiredFields: ["name", "phone or email"],
    optionalFields: ["estimate_amount", "estimate_date", "service_type", "sales_rep"],
  },
  {
    key: "appointment-reminders",
    name: "Appointment Reminders",
    category: "Scheduling",
    description:
      "Generate confirmations and reminders from calendar or CRM appointment events.",
    eventType: "appointment.reminder_due",
    workflowTemplates: ["appointment_reminder"],
    outcome:
      "Approval-gated reminder with appointment time and rescheduling instructions.",
    requiredFields: ["name", "phone or email", "appointment_time"],
    optionalFields: ["address", "assigned_staff", "service_type"],
  },
  {
    key: "review-request",
    name: "Review + Referral Request",
    category: "Reputation",
    description:
      "Thank customers after completed work and prepare a review request through their preferred channel.",
    eventType: "job.completed",
    workflowTemplates: ["review_request"],
    outcome:
      "Personalized review request, approval item, delivery log, and CRM timeline contribution.",
    requiredFields: ["name", "phone or email"],
    optionalFields: ["service_type", "job_summary", "review_url", "technician"],
  },
  {
    key: "sync-health",
    name: "Integration Failure Alert",
    category: "Systems",
    description:
      "Normalize provider failures so partners can see and troubleshoot broken CRM, phone, email, and automation connections.",
    eventType: "sync.failed",
    workflowTemplates: ["sync_failure_alert"],
    outcome:
      "Failure run, health status, action log, and troubleshooting context without exposing credentials.",
    requiredFields: ["provider", "error_message"],
    optionalFields: ["external_id", "attempt", "operation"],
  },
];

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

