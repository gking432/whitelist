import type { CapabilityKey } from "../packages/capabilities.ts";

export type FeatureTestDefinition = {
  capabilityKey: CapabilityKey;
  testMode: "automated" | "guided" | "unavailable";
  whatWorks: string;
  scenarioKeys: string[];
  expectedTemplateKeys: string[];
  steps: string[];
  expectedResult: string;
};

export const FEATURE_TEST_DEFINITIONS: Record<
  CapabilityKey,
  FeatureTestDefinition
> = {
  northstar_crm: {
    capabilityKey: "northstar_crm",
    testMode: "guided",
    whatWorks:
      "The built-in CRM supports contacts, pipeline, tasks, inbox, scheduling, calls, quotes, feedback, and reports with tenant isolation.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Open CRM as the client or as the partner's own agency.",
      "Create a clearly labeled test lead and confirm its AI analysis, pipeline card, contact, task, and timeline entry.",
      "Move the lead through the pipeline, complete its task, and create a test appointment.",
      "Return as the partner supporting a managed client and confirm the CRM is visible but customer actions remain read-only.",
    ],
    expectedResult:
      "The test record stays inside the selected business, appears across the CRM workspace, and preserves partner read-only boundaries.",
  },
  lead_intake: {
    capabilityKey: "lead_intake",
    testMode: "automated",
    whatWorks: "Synthetic website leads enter the workflow engine and are recorded in the configured Northstar intake path.",
    scenarioKeys: ["website_lead"],
    expectedTemplateKeys: ["new_lead_intake"],
    steps: [
      "Confirm the intake workflow is active and the business is not in live mode.",
      "Tap Run automated test to submit a clearly labeled synthetic website lead.",
      "Open Health & Logs and confirm the intake event and workflow completed.",
      "If Northstar CRM is enabled, open CRM and find the test contact.",
    ],
    expectedResult: "The event is processed, the lead workflow runs, and the test contact appears in Northstar CRM when that CRM is enabled.",
  },
  crm_sync: {
    capabilityKey: "crm_sync",
    testMode: "automated",
    whatWorks: "Northstar records CRM activity and surfaces provider-sync failures. External CRM delivery still requires checking the connected CRM.",
    scenarioKeys: ["provider_failure"],
    expectedTemplateKeys: ["sync_failure_alert"],
    steps: [
      "Confirm the CRM connection shows Connected under Integrations.",
      "Tap Run automated test to create a simulated provider failure.",
      "Confirm the sync-failure workflow appears in Health & Logs.",
      "For a real CRM check, submit a test lead and verify its AI Assistant note inside the connected CRM.",
    ],
    expectedResult: "Northstar detects and logs the simulated sync failure. A real connection test must also be confirmed inside the external CRM.",
  },
  message_drafting: {
    capabilityKey: "message_drafting",
    testMode: "automated",
    whatWorks: "Missed-call rescue and estimate follow-up messages are drafted and held for client approval.",
    scenarioKeys: ["missed_call", "estimate_follow_up"],
    expectedTemplateKeys: ["missed_call_rescue", "estimate_follow_up"],
    steps: [
      "Tap Run automated test to simulate a missed call and an aging estimate.",
      "Confirm both drafting workflows appear in Health & Logs.",
      "Have an authorized client user open Approvals and review the synthetic drafts.",
      "Do not use a real customer address or phone number during testing.",
    ],
    expectedResult: "Both workflows create drafts and pause for the client. The partner can inspect the result but cannot approve it.",
  },
  approval_gated_sending: {
    capabilityKey: "approval_gated_sending",
    testMode: "guided",
    whatWorks: "Authorized client or agency staff can approve a draft; delivery follows the connection runtime mode.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Create a synthetic draft using the Lead intake or Message drafting test.",
      "Open the client Action Center as an authorized client test user.",
      "Review and approve the draft there. Partners remain read-only for managed clients.",
      "Confirm a dry-run delivery record in sandbox, or confirm receipt only when intentionally testing a live provider.",
    ],
    expectedResult: "The client decision is audited and the delivery result matches sandbox or live mode without partner intervention.",
  },
  ai_intake_routing: {
    capabilityKey: "ai_intake_routing",
    testMode: "automated",
    whatWorks: "Inbound messages are classified by intent and urgency, including emergency escalation wording.",
    scenarioKeys: ["urgent_lead"],
    expectedTemplateKeys: ["ai_intake_router"],
    steps: [
      "Tap Run automated test to submit an after-hours burst-pipe request.",
      "Confirm the AI intake workflow completed in Health & Logs.",
      "Check that the result is marked urgent or emergency and routed for human attention.",
    ],
    expectedResult: "The synthetic lead is classified as urgent and receives the expected emergency routing category.",
  },
  quote_intelligence: {
    capabilityKey: "quote_intelligence",
    testMode: "guided",
    whatWorks:
      "The CRM quote assistant calculates and records a transparent ballpark range using configurable labor, material, complexity, and urgency inputs.",
    scenarioKeys: [],
    expectedTemplateKeys: ["estimate_follow_up"],
    steps: [
      "Open CRM, then Quotes.",
      "Enter a clearly labeled test service with labor, materials, complexity, and urgency.",
      "Create the quote and inspect the saved low/high range and explanation.",
      "Confirm no customer message was sent automatically.",
    ],
    expectedResult:
      "A quote with a reproducible range and explanation is saved in the selected business without customer contact.",
  },
  feedback_intelligence: {
    capabilityKey: "feedback_intelligence",
    testMode: "guided",
    whatWorks:
      "The CRM analyzes feedback, assigns sentiment and risk, drafts an internal action and customer response, and creates a manager task for serious issues.",
    scenarioKeys: [],
    expectedTemplateKeys: ["review_request"],
    steps: [
      "Open CRM, then Feedback.",
      "Submit one positive and one clearly labeled critical test review.",
      "Inspect the sentiment, risk, summary, recommended action, and response draft.",
      "Open Tasks and confirm the critical review created a manager follow-up.",
    ],
    expectedResult:
      "Both reviews are analyzed and the critical review creates an actionable task without sending the drafted response.",
  },
  automation_packs: {
    capabilityKey: "automation_packs",
    testMode: "guided",
    whatWorks:
      "Northstar provides concrete n8n workflows, Make blueprints, and Zapier recipes for eight common customer automation flows.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Open Automation Packs from the client workspace.",
      "Download the same pack in n8n, Make, and Zapier formats.",
      "Import it into the selected automation platform and enter the client-specific Northstar webhook URL and token.",
      "Run the platform's test step and verify the event in Health & Logs.",
    ],
    expectedResult:
      "The selected external platform receives its template and a test execution enters Northstar as the documented event type.",
  },
  website_ai_chat: {
    capabilityKey: "website_ai_chat",
    testMode: "guided",
    whatWorks: "The hosted website widget answers from approved business knowledge, captures contact details, and sends completed conversations through normal intake.",
    scenarioKeys: [],
    expectedTemplateKeys: ["ai_intake_router"],
    steps: [
      "Have the partner enable the Northstar web chat connection and copy its hosted widget URL.",
      "Open that URL as a customer and ask a real service question using clearly labeled test contact information.",
      "Complete the conversation with a phone number or email address.",
      "Return to CRM, Approvals, and Activity and find the completed chat, contact, and response draft.",
    ],
    expectedResult: "The widget answers from approved knowledge and the completed conversation appears as a normal lead with routing, CRM, and approval evidence.",
  },
  live_call_assistant: {
    capabilityKey: "live_call_assistant",
    testMode: "guided",
    whatWorks:
      "The CRM call lab shows the live transcript, caller details, urgency, tools used, and post-call CRM summary. Real carrier calls still require the phone bridge.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Open CRM, then AI Calls, and start a test call.",
      "Speak as the customer by entering a name, contact details, service need, and urgency.",
      "Confirm the transcript and assistant events update during the call.",
      "End the call and inspect the saved CRM note and follow-up activity.",
    ],
    expectedResult:
      "The complete assistant experience is testable in the browser and records its call artifacts; carrier audio remains disabled until connected.",
  },
  live_scheduling_assistant: {
    capabilityKey: "live_scheduling_assistant",
    testMode: "guided",
    whatWorks:
      "The call lab listens for scheduling intent and opens a slot popup using Google Calendar when connected or Northstar availability otherwise.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Set business hours under CRM, then Schedule.",
      "Start a test call and ask for a specific day or time, such as Friday morning.",
      "Confirm the popup proposes slots that match the customer's request and existing appointments.",
      "Select a slot and confirm the booking request enters the approval flow.",
    ],
    expectedResult:
      "The popup proposes valid slots and records the selected booking request without bypassing approval.",
  },
  ai_phone_answering: {
    capabilityKey: "ai_phone_answering",
    testMode: "guided",
    whatWorks:
      "The browser phone simulation and Twilio Voice webhook run the same agent tools. OpenAI supplies the live intelligence when configured; the browser lab has a deterministic fallback.",
    scenarioKeys: [],
    expectedTemplateKeys: ["missed_call_rescue"],
    steps: [
      "Open CRM, then AI Calls, and start a test call.",
      "Enter a realistic multi-turn customer conversation and exercise contact capture, scheduling, and escalation.",
      "End the call and inspect the call record, transcript, CRM note, approvals, and tasks.",
      "After connecting Twilio and OpenAI, paste the displayed voice and status callback URLs into the Twilio number and place a test call.",
    ],
    expectedResult:
      "The browser lab proves the workflow without credentials; a configured Twilio number answers, transcribes, runs the same tools, and completes the CRM pipeline.",
  },
  appointment_booking: {
    capabilityKey: "appointment_booking",
    testMode: "automated",
    whatWorks: "Google Calendar availability, constrained slot proposals, approval-gated event creation, confirmation drafts, and reminder drafts are implemented.",
    scenarioKeys: ["appointment_reminder"],
    expectedTemplateKeys: ["appointment_reminder"],
    steps: [
      "Test the calendar connection under Integrations.",
      "Tap Run automated test to create a synthetic upcoming appointment event.",
      "Confirm the reminder workflow creates a client approval item.",
      "As the client, approve a clearly labeled test booking proposal while Google Calendar is connected in live mode.",
      "Open Google Calendar and verify the event, then remove it after testing.",
    ],
    expectedResult: "The reminder draft is created, real availability is honored, and an approved live booking creates a Google Calendar event plus a separate confirmation approval.",
  },
  review_requests: {
    capabilityKey: "review_requests",
    testMode: "automated",
    whatWorks: "A completed-job event creates a personalized review-request draft for client approval.",
    scenarioKeys: ["job_completed"],
    expectedTemplateKeys: ["review_request"],
    steps: [
      "Tap Run automated test to create a synthetic completed job.",
      "Confirm the review-request workflow pauses for approval.",
      "Have an authorized client test user inspect the draft in Approvals.",
    ],
    expectedResult: "A review-request draft is created without sending anything to a real customer.",
  },
  reports_portal: {
    capabilityKey: "reports_portal",
    testMode: "guided",
    whatWorks: "Northstar reports workflow activity, approvals, integration health, and operational value from recorded events.",
    scenarioKeys: [],
    expectedTemplateKeys: [],
    steps: [
      "Run at least one automated feature test so reporting has activity.",
      "Open Reports and confirm the test run appears in the selected date range.",
      "Confirm client branding and support details are correct before sharing a report.",
    ],
    expectedResult: "Recent workflow activity and health data appear in the report without requiring a separate client dashboard.",
  },
};

export function featureTestsForCapabilities(capabilityKeys: CapabilityKey[]) {
  return capabilityKeys.map((key) => FEATURE_TEST_DEFINITIONS[key]);
}
