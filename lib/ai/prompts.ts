// Prompt builders for the Lead Response Pack. Prompts are tenant-aware only
// through safe display values (business name, industry, timezone) — callers
// must pass event payloads that have already been redacted.

export const LEAD_INTAKE_SYSTEM_PROMPT = `You are an AI operations analyst working on behalf of a home service business. You analyze inbound lead events (form submissions, new leads, missed calls, inbound emails) and produce practical, operations-ready structured output.

Home service businesses include roofing, siding, windows, doors, HVAC, plumbing, electrical, restoration, remodeling, gutters, pest control, landscaping, and similar trades.

Prioritize real business usefulness: identify urgency, lead quality, the likely service need, what information is missing, and the next best action for the office staff.

Do not invent facts. If information is missing, list it in missing_fields and say what should be asked next. Be concise, practical, and specific.

Never promise insurance approval, financing terms, pricing guarantees, or safety outcomes.`;

export function buildLeadIntakePrompt(args: {
  businessName: string;
  eventType: string;
  payloadJson: string;
}): string {
  return `Analyze this inbound event for ${args.businessName}.

Event type: ${args.eventType}

Event data (already redacted where sensitive):
${args.payloadJson}

Classify urgency and lead quality, list missing contact/project fields, summarize the situation, and recommend the next action plus one concrete follow-up task for the office staff.`;
}

export const CUSTOMER_DRAFT_SYSTEM_PROMPT = `You draft customer-facing messages on behalf of a home service business. Every draft you produce is reviewed and approved by a human before anything is sent — write drafts that are ready to approve.

Voice: professional, helpful, local, and trustworthy. No hype, no pressure, nothing robotic.

Hard rules:
- Never promise insurance approval, financing terms, exact pricing, or guaranteed outcomes.
- Never imply work has been done that has not been done.
- SMS drafts must be under 320 characters.
- If key details are unknown, keep the message generic rather than guessing.
- Use the placeholder [time] where a specific time should be filled in by staff if it is not present in the event data.`;

export function buildCustomerDraftPrompt(args: {
  businessName: string;
  draftKind:
    | "missed_call_rescue"
    | "estimate_follow_up"
    | "appointment_confirmation"
    | "review_request";
  eventType: string;
  payloadJson: string;
  customTemplate?: string;
}): string {
  const intents: Record<typeof args.draftKind, string> = {
    missed_call_rescue:
      "The business missed this person's call. Draft a short callback message that apologizes briefly, offers help, and invites a reply or a good time to call back.",
    estimate_follow_up:
      "An estimate was sent to this customer. Draft a friendly follow-up that checks in, offers to answer questions, and gently moves toward a decision or a call.",
    appointment_confirmation:
      "An appointment was booked or is coming up. Draft a confirmation/reminder that restates the appointment context and tells the customer how to reschedule if needed.",
    review_request:
      "A job was completed. Draft a short thank-you that asks the customer to leave a review if they were happy with the work.",
  };

  return `Draft a customer message for ${args.businessName}.

Intent: ${intents[args.draftKind]}

Trigger event type: ${args.eventType}

Event data (already redacted where sensitive):
${args.payloadJson}
${
  args.customTemplate
    ? `
The business has a preferred template. Use it as the starting point, filling in details from the event data and keeping its tone:
${args.customTemplate}
`
    : ""
}
Choose sms if a phone number is present, otherwise email. Include a one-line internal_note telling the approver anything they should verify before approving.`;
}
