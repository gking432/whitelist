import type { DailyBriefData, SampleMetric, SampleMetricPoint } from "./daily-brief.ts";
import { emptyDesignPreview } from "./design-preview.ts";
import type { TodoSnapshot } from "./todo-types.ts";
import type { ConversationSnapshot } from "../conversations/types.ts";
import type { ManagerChatSnapshot } from "../agents/manager-chat.ts";

/** A fixed fictional morning keeps the calendar, queue order, and chart windows coherent. */
export const SAMPLE_PREVIEW_AT = "2027-02-24T15:15:00.000Z";
export type SamplePreviewAction = {
  approvalId: string;
  resolution: "approve" | "reject";
  editedContent: string;
  bookedSlot?: { start_iso: string; end_iso: string };
};

export function parseSamplePreviewHistory(raw: string | null): SamplePreviewAction[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 20).filter((item): item is SamplePreviewAction => {
      if (!item || typeof item !== "object") return false;
      const action = item as Record<string, unknown>;
      return typeof action.approvalId === "string" && action.approvalId.startsWith("sample-") &&
        (action.resolution === "approve" || action.resolution === "reject") &&
        typeof action.editedContent === "string" && action.editedContent.length <= 2000;
    });
  } catch {
    return [];
  }
}

function metricPoints(entries: [daysAgo: number, amount: number][]): SampleMetricPoint[] {
  const anchor = Date.parse(SAMPLE_PREVIEW_AT);
  return entries.map(([daysAgo, amount]) => ({
    at: new Date(anchor - daysAgo * 86_400_000).toISOString(),
    amount,
  }));
}

const sampleMetrics: Record<SampleMetric, SampleMetricPoint[]> = {
  leads: metricPoints([[0, 2], [2, 1], [4, 1], [6, 1], [9, 2], [13, 1], [17, 2], [21, 2], [27, 2], [41, 5], [65, 7]]),
  payments: metricPoints([[1, 1], [3, 2], [6, 1], [11, 1], [18, 2], [26, 1], [47, 3], [72, 2]]),
  outbound_email: metricPoints([[0, 3], [1, 2], [3, 4], [5, 2], [8, 4], [12, 3], [15, 4], [20, 3], [25, 4], [39, 6], [61, 8]]),
  sales: metricPoints([[2, 1800], [5, 2250], [10, 1450], [16, 2700], [23, 1600], [27, 1000], [35, 4800], [48, 4200], [73, 3100]]),
  outbound_calls: metricPoints([[0, 4], [1, 3], [3, 5], [6, 4], [9, 5], [14, 6], [19, 7], [25, 7], [43, 9], [67, 12]]),
};
const lastMonth = new Date(SAMPLE_PREVIEW_AT);
lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
const lastMonthKey = lastMonth.toISOString().slice(0, 7);
const lastMonthSales = sampleMetrics.sales
  .filter((point) => point.at.startsWith(lastMonthKey))
  .reduce((total, point) => total + point.amount, 0);

/** Static presentation records only. This module does not read accounts or call APIs. */
export function createSamplePreview(): DailyBriefData {
  const base = emptyDesignPreview(SAMPLE_PREVIEW_AT);
  return {
    ...base,
    displayName: "Gunnar",
    sampleMetrics,
    previewQueueRows: [
      {
        key: "connected-invoice:sample-billing:sample-invoice-1042",
        title: "Past-due invoice for Rivera Workshop",
        detail: "INV-1042 · $1,250 still unpaid. The agent sent a follow-up email this morning.",
        label: "Follow-up sent",
        kind: "invoice",
        href: "/preview/money",
      },
      {
        key: "sample-monthly-report",
        title: `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(lastMonthSales)} in orders last month`,
        detail: "Your January sales report is ready when you have a moment.",
        label: "Monthly report",
        kind: "report",
        href: "/preview/report",
      },
    ],
    workspace: {
      ...base.workspace,
      clientName: "Sample studio",
      workspaceScopeKey: "public-sample-workspace-v1",
      profile: {
        ...base.workspace.profile,
        description: "A small creative studio serving local businesses.",
        industry: "creative services",
        services: "Brand strategy, web design, and launch planning",
        audience: "Small businesses and founders",
        currency: "USD",
      },
      contacts: [
        { id: "sample-contact-jayden", first_name: "Jayden", last_name: "Ellis", email: "jayden@example.invalid", phone: null, source: "Sample email" },
        { id: "sample-contact-jamie", first_name: "Jamie", last_name: "Morgan", email: "jamie@example.invalid", phone: null, source: "Sample CRM" },
        { id: "sample-contact-maya", first_name: "Maya", last_name: "Patel", email: "maya@example.invalid", phone: null, source: "Sample CRM" },
        { id: "sample-contact-sam", first_name: "Sam", last_name: "Rivera", email: "sam@example.invalid", phone: null, source: "Sample email" },
      ],
    },
    connectedData: {
      ...base.connectedData!,
      // The source names and the route banner identify all of these as examples.
      // Their provider keys let the same app summaries process fictional records.
      apps: [
        { id: "sample-intake", name: "Sample intake", account: "Example records", provider: "generic_inbound_webhook", status: "connected", paused: false, readOnly: true, lastSyncedAt: SAMPLE_PREVIEW_AT, syncing: false, error: null },
        { id: "sample-mail", name: "Sample mail and calendar", account: "Example records", provider: "google_workspace", status: "connected", paused: false, readOnly: true, lastSyncedAt: SAMPLE_PREVIEW_AT, syncing: false, error: null },
        { id: "sample-billing", name: "Sample billing", account: "Example records", provider: "stripe", status: "connected", paused: false, readOnly: true, lastSyncedAt: SAMPLE_PREVIEW_AT, syncing: false, error: null },
      ],
      customers: [
        { id: "sample-customer-jayden", connectionId: "sample-crm", externalId: "jayden", accountId: "sample", account: "Sample CRM", name: "Jayden Ellis", email: "jayden@example.invalid", phone: null, lifecycleStage: "lead", archived: false, sourceUpdatedAt: "2027-02-24T14:32:00.000Z", observedAt: SAMPLE_PREVIEW_AT, revision: "sample-1", href: null },
        { id: "sample-customer-jamie", connectionId: "sample-crm", externalId: "jamie", accountId: "sample", account: "Sample CRM", name: "Jamie Morgan", email: "jamie@example.invalid", phone: null, lifecycleStage: "customer", archived: false, sourceUpdatedAt: "2027-02-24T14:12:00.000Z", observedAt: SAMPLE_PREVIEW_AT, revision: "sample-1", href: null },
        { id: "sample-customer-maya", connectionId: "sample-crm", externalId: "maya", accountId: "sample", account: "Sample CRM", name: "Maya Patel", email: "maya@example.invalid", phone: null, lifecycleStage: "customer", archived: false, sourceUpdatedAt: "2027-02-18T18:00:00.000Z", observedAt: SAMPLE_PREVIEW_AT, revision: "sample-1", href: null },
        { id: "sample-customer-sam", connectionId: "sample-crm", externalId: "sam", accountId: "sample", account: "Sample CRM", name: "Sam Rivera", email: "sam@example.invalid", phone: null, lifecycleStage: "lead", archived: false, sourceUpdatedAt: "2027-02-23T18:00:00.000Z", observedAt: SAMPLE_PREVIEW_AT, revision: "sample-1", href: null },
      ],
      leads: [
        { id: "sample-lead-jayden", connectionId: "sample-intake", externalId: "jayden", nativeId: null, account: "Sample intake", provider: "generic_inbound_webhook", title: "Jayden asked for a consultation", status: "reviewed", receivedAt: "2027-02-24T14:32:00.000Z", href: null, preview: "Friday at 2:00, or 2:30 if needed." },
        { id: "sample-lead-sam", connectionId: "sample-intake", externalId: "sam", nativeId: null, account: "Sample intake", provider: "generic_inbound_webhook", title: "Sam sent a website brief", status: "reviewed", receivedAt: "2027-02-23T18:00:00.000Z", href: null, preview: "Looking for a refreshed website." },
      ],
      messages: [
        { id: "sample-email-followup", connectionId: "sample-mail", threadId: "invoice-followup", subject: "Following up on invoice INV-1042", from: "studio@example.invalid", preview: "A friendly reminder was sent to Rivera Workshop.", receivedAt: "2027-02-24T13:40:00.000Z", unread: false, inbox: false, account: "Sample mail", href: null, messageCount: 1, provider: "google_workspace", direction: "outbound" },
        { id: "sample-email-jayden", connectionId: "sample-mail", threadId: "jayden-request", subject: "Consultation this Friday", from: "jayden@example.invalid", preview: "Could I come in Friday at 2? 2:30 also works.", receivedAt: "2027-02-24T14:32:00.000Z", unread: false, inbox: true, account: "Sample mail", href: null, messageCount: 2, provider: "google_workspace", direction: "inbound" },
      ],
      appointments: [
        { id: "sample-review-brief", nativeId: null, title: "Review Sam’s website brief", startAt: "2027-02-24T16:00:00.000Z", endAt: "2027-02-24T16:45:00.000Z", allDay: false, account: "Sample calendar", href: null, connectionId: "sample-mail", provider: "google_workspace", status: "booked" },
        { id: "sample-studio-planning", nativeId: null, title: "Studio planning", startAt: "2027-02-25T19:00:00.000Z", endAt: "2027-02-25T19:45:00.000Z", allDay: false, account: "Sample calendar", href: null, connectionId: "sample-mail", provider: "google_workspace", status: "booked" },
        { id: "sample-client-handoff", nativeId: null, title: "Client handoff call", startAt: "2027-02-26T19:45:00.000Z", endAt: "2027-02-26T20:15:00.000Z", allDay: false, account: "Sample calendar", href: null, connectionId: "sample-mail", provider: "google_workspace", status: "booked" },
      ],
      invoices: [
        { id: "sample-invoice-1042", connectionId: "sample-billing", externalId: "1042", account: "Rivera Workshop", provider: "stripe", number: "INV-1042", status: "past_due", currency: "USD", totalMinor: 125000, amountDueMinor: 125000, amountPaidMinor: 0, dueAt: "2027-02-20T18:00:00.000Z", updatedAt: "2027-02-24T13:40:00.000Z", href: null },
        { id: "sample-invoice-1048", connectionId: "sample-billing", externalId: "1048", account: "Northwood Studio", provider: "stripe", number: "INV-1048", status: "open", currency: "USD", totalMinor: 85000, amountDueMinor: 85000, amountPaidMinor: 0, dueAt: "2027-03-01T18:00:00.000Z", updatedAt: "2027-02-22T18:00:00.000Z", href: null },
      ],
      payments: [
        { id: "sample-payment-411", connectionId: "sample-billing", externalId: "411", account: "Fieldwork Consulting", provider: "stripe", status: "succeeded", currency: "USD", amountMinor: 220000, amountRefundedMinor: 0, updatedAt: "2027-02-23T16:00:00.000Z", href: null },
      ],
    },
    tasks: [
      { id: "sample-task-brief", title: "Review Sam’s project brief", description: "Sam sent a website brief. Check the scope before the next conversation.", priority: "high", status: "open", due_at: "2027-02-24T23:00:00.000Z" },
      { id: "sample-task-portfolio", title: "Choose images for the portfolio update", description: "Pick three recent projects to feature on the site.", priority: "normal", status: "open", due_at: "2027-03-03T23:00:00.000Z" },
    ],
    appointments: [
      { id: "sample-review-brief", title: "Review Sam’s website brief", start_at: "2027-02-24T16:00:00.000Z", end_at: "2027-02-24T16:45:00.000Z", status: "booked", sourceAccount: "Sample calendar" },
      { id: "sample-studio-planning", title: "Studio planning", start_at: "2027-02-25T19:00:00.000Z", end_at: "2027-02-25T19:45:00.000Z", status: "booked", sourceAccount: "Sample calendar" },
      { id: "sample-client-handoff", title: "Client handoff call", start_at: "2027-02-26T19:45:00.000Z", end_at: "2027-02-26T20:15:00.000Z", status: "booked", sourceAccount: "Sample calendar" },
    ],
    approvals: [
      {
        id: "sample-jayden-booking",
        title: "Jayden requested an appointment",
        summary: "Jayden asked for Friday, Feb 26 at 2:00 PM. The agent found a calendar conflict and offered 2:30 PM instead. Jayden said that works. Approve the 2:30 booking and the agent’s confirmation reply?",
        created_at: "2027-02-24T14:36:00.000Z",
        type: "appointment_booking",
        editable_content: "Hi Jayden, Friday, February 26 at 2:30 PM is confirmed. See you then!",
        proposed_payload: {
          customer_name: "Jayden Ellis",
          to: "jayden@example.invalid",
          requested_slot: { start_iso: "2027-02-26T20:00:00.000Z", end_iso: "2027-02-26T20:30:00.000Z" },
          slot: { start_iso: "2027-02-26T20:30:00.000Z", end_iso: "2027-02-26T21:00:00.000Z" },
          next_step: "Book Friday at 2:30 PM and send the drafted confirmation.",
        },
      },
      {
        id: "sample-jamie-reply",
        title: "Reply to Jamie about the next phase",
        summary: "Jamie Morgan, a returning customer, asked about the next phase of the brand project. The agent drafted a friendly reply proposing a Thursday afternoon catch-up. Review it before sending.",
        created_at: "2027-02-24T14:45:00.000Z",
        type: "customer_message",
        editable_content: "Hi Jamie, lovely to hear from you. I can hold Thursday at 2:00 for a 30-minute catch-up. Shall we pick up where we left off?",
        proposed_payload: { to: "jamie@example.invalid", subject: "Next phase of your project", next_step: "Send the reviewed reply to Jamie." },
      },
      {
        id: "sample-energy-bill",
        title: "Energy bill is due in three days",
        summary: "The sample energy bill for $284.16 is due Saturday, Feb 27. Autopay is scheduled. You can pay now or keep autopay as planned.",
        created_at: "2027-02-24T15:00:00.000Z",
        type: "sample_bill",
        editable_content: null,
        proposed_payload: { payee: "City Energy", amount_minor: 28416, currency: "USD", due_at: "2027-02-27", autopay: true, next_step: "Pay now or keep the scheduled autopay." },
      },
      {
        id: "sample-task-review",
        title: "Review Sam’s project brief",
        summary: "Sam sent a website brief for a possible new project. Your 10:00 AM working block is set aside for it. Mark the review complete when you finish, or keep it on your list.",
        created_at: "2027-02-24T15:05:00.000Z",
        type: "sample_task",
        editable_content: null,
        proposed_payload: { task_id: "sample-task-brief", next_step: "Mark the review complete or keep it on your list." },
      },
    ],
    conversations: [],
    work: [
      { id: "sample-work-invoice-followup", title: "Followed up on overdue invoice", status: "completed", summary: "The agent sent Rivera Workshop a friendly reminder about INV-1042. The $1,250 invoice is still unpaid.", updated_at: "2027-02-24T13:40:00.000Z" },
      { id: "sample-work-jayden", title: "Found a time that works for Jayden", status: "completed", summary: "The agent checked Friday’s calendar, proposed 2:30 PM, and saved a confirmation draft for your approval.", updated_at: "2027-02-24T14:36:00.000Z" },
      { id: "sample-work-leads", title: "Sorted new inquiries", status: "completed", summary: "Two recent inquiries were matched with customer records and added to your morning flow.", updated_at: "2027-02-24T14:05:00.000Z" },
    ],
    teamStatus: "active",
    counts: { tasks: 2, approvals: 4, conversations: 0, blockedWork: 0 },
  };
}

/** Replay a local demo decision into every preview tab. This never touches an API. */
export function applySamplePreviewAction(data: DailyBriefData, action: SamplePreviewAction): DailyBriefData {
  const approval = data.approvals.find((item) => item.id === action.approvalId);
  if (!approval) return data;
  const approved = action.resolution === "approve";
  const title = approval.type === "appointment_booking"
    ? approved ? "Booked Jayden at 2:30 PM (sample)" : "Declined Jayden’s booking (sample)"
    : approval.type === "customer_message"
      ? approved ? "Approved Jamie’s reply (sample)" : "Declined Jamie’s reply (sample)"
      : approval.type === "sample_bill"
        ? approved ? "Paid the energy bill (sample)" : "Kept energy bill autopay (sample)"
        : approved ? "Completed Sam’s brief review (sample)" : "Kept Sam’s review on the list (sample)";
  const summary = approval.type === "appointment_booking"
    ? approved ? "A 2:30 PM sample calendar booking and confirmation were recorded. No real message was sent." : "The proposed booking was dismissed. No sample calendar event was added."
    : approval.type === "customer_message"
      ? approved ? "The reviewed reply was recorded in the sample conversation. No real email was sent." : "The drafted reply was dismissed. No email was sent."
      : approval.type === "sample_bill"
        ? approved ? "The sample bill is marked paid; the scheduled sample autopay was cleared. No payment was made." : "The sample autopay remains scheduled. No payment was made."
        : approved ? "The sample owner task was marked complete." : "The sample owner task remains open.";
  const generatedAt = new Date(Date.parse(data.generatedAt) + 60_000).toISOString();
  const booked = approved && approval.type === "appointment_booking" && action.bookedSlot &&
    Date.parse(action.bookedSlot.end_iso) > Date.parse(action.bookedSlot.start_iso)
    ? {
        id: "sample-jayden-confirmed",
        title: "Consultation with Jayden",
        start_at: action.bookedSlot.start_iso,
        end_at: action.bookedSlot.end_iso,
        status: "booked",
        sourceAccount: "Sample calendar",
      }
    : null;
  const sent = approved && ["appointment_booking", "customer_message"].includes(approval.type ?? "") && action.editedContent.trim();
  const recipient = approval.type === "appointment_booking" ? "jayden@example.invalid" : "jamie@example.invalid";
  const nextTasks = approved && approval.type === "sample_task"
    ? data.tasks.filter((task) => task.id !== approval.proposed_payload?.task_id)
    : data.tasks;
  return {
    ...data,
    generatedAt,
    approvals: data.approvals.filter((item) => item.id !== action.approvalId),
    appointments: booked ? [...data.appointments, booked] : data.appointments,
    tasks: nextTasks,
    counts: {
      ...data.counts,
      approvals: Math.max(0, data.counts.approvals - 1),
      tasks: nextTasks.filter((task) => task.status === "open").length,
    },
    work: [
      { id: `sample-decision-${approval.id}`, title, summary, status: "completed", updated_at: generatedAt },
      ...data.work,
    ],
    connectedData: data.connectedData ? {
      ...data.connectedData,
      generatedAt,
      appointments: booked ? [
        ...data.connectedData.appointments,
        { id: booked.id, nativeId: null, title: booked.title, startAt: booked.start_at, endAt: booked.end_at, allDay: false, account: "Sample calendar", href: null, connectionId: "sample-mail", provider: "google_workspace", status: "booked" },
      ] : data.connectedData.appointments,
      messages: sent ? [
        ...data.connectedData.messages,
        { id: `sample-sent-${approval.id}`, connectionId: "sample-mail", threadId: approval.id, subject: approval.type === "appointment_booking" ? "Friday consultation confirmed" : "Next phase of your project", from: "studio@example.invalid", preview: action.editedContent.trim(), receivedAt: generatedAt, unread: false, inbox: false, account: "Sample mail", href: null, messageCount: 1, provider: "google_workspace", direction: "outbound" },
      ] : data.connectedData.messages,
      payments: approved && approval.type === "sample_bill" ? [
        ...(data.connectedData.payments ?? []),
        { id: "sample-energy-payment", connectionId: "sample-billing", externalId: "energy-payment", account: "City Energy", provider: "sample", status: "succeeded", currency: "USD", amountMinor: 28416, amountRefundedMinor: 0, updatedAt: generatedAt, href: null },
      ] : data.connectedData.payments,
    } : data.connectedData,
  };
}

export function sampleTodoSnapshot(data: DailyBriefData): TodoSnapshot {
  const reviewedSam = data.work.some((item) => item.id === "sample-decision-sample-task-review" && item.title.startsWith("Completed"));
  return {
    workspace: data.workspace,
    tasks: data.tasks.map((task) => ({
      ...task,
      status: task.status === "done" ? "done" as const : "open" as const,
      updated_at: data.generatedAt,
    })).concat([
      ...(reviewedSam ? [{ id: "sample-task-brief", title: "Review Sam’s project brief", description: "Sam sent a website brief for a possible new project.", status: "done" as const, priority: "high", due_at: "2027-02-24T23:00:00.000Z", updated_at: data.generatedAt }] : []),
      { id: "sample-task-notes", title: "Organize this week’s working notes", description: "Keep the handoff notes in one place.", status: "done" as const, priority: "normal", due_at: "2027-02-23T23:00:00.000Z", updated_at: "2027-02-23T22:00:00.000Z" },
    ]),
    work: data.work.map((item) => ({
      ...item,
      agent_key: "operations",
      revision: 1,
      approval_id: null,
      conversation_id: null,
      result_record_id: null,
    })),
    timeZone: data.timeZone,
    generatedAt: data.generatedAt,
    limited: false,
    errors: [],
  };
}

export function sampleConversationSnapshot(data: DailyBriefData): ConversationSnapshot {
  const common = {
    partner_id: "sample",
    client_id: "sample",
    connection_id: "sample-mail",
    channel: "email" as const,
    external_thread_id: "sample",
    lead_id: null,
    identity_status: "owner_verified" as const,
    mode: "agent" as const,
    opted_out: false,
    revision: 1,
  };
  return {
    conversations: [
      { ...common, id: "sample-conversation-jayden", contact_id: "sample-contact-jayden", state: data.approvals.some((item) => item.id === "sample-jayden-booking") ? "waiting_approval" : "closed", agent_key: "scheduling", summary: "Jayden requested Friday at 2:00 PM and agreed to 2:30 PM after the agent found a conflict.", next_action: data.approvals.some((item) => item.id === "sample-jayden-booking") ? "Approve the 2:30 PM booking and confirmation" : "Booking decision recorded", updated_at: "2027-02-24T14:36:00.000Z" },
      { ...common, id: "sample-conversation-jamie", contact_id: "sample-contact-jamie", state: data.approvals.some((item) => item.id === "sample-jamie-reply") ? "waiting_approval" : "closed", agent_key: "customer", summary: "Jamie wants to talk through the next phase of the brand project.", next_action: data.approvals.some((item) => item.id === "sample-jamie-reply") ? "Review the drafted reply" : "Reply decision recorded", updated_at: "2027-02-24T14:45:00.000Z" },
      { ...common, id: "sample-conversation-sam", contact_id: "sample-contact-sam", state: "open", agent_key: "customer", summary: "Sam sent a website brief for a new project.", next_action: "Review Sam’s brief", updated_at: "2027-02-23T18:00:00.000Z" },
    ],
    messages: [
      { id: "sample-message-jayden", conversation_id: "sample-conversation-jayden", direction: "inbound", body: "Could I come in Friday at 2? If you’re booked, 2:30 also works.", status: "received", approval_id: null, metadata: {}, created_at: "2027-02-24T14:32:00.000Z" },
      { id: "sample-message-jayden-agent", conversation_id: "sample-conversation-jayden", direction: "outbound", body: "Let me check the calendar and confirm shortly.", status: "sent", approval_id: null, metadata: {}, created_at: "2027-02-24T14:34:00.000Z" },
      { id: "sample-message-jamie", conversation_id: "sample-conversation-jamie", direction: "inbound", body: "I’d love to talk through the next phase. Do you have time Thursday afternoon?", status: "received", approval_id: null, metadata: {}, created_at: "2027-02-24T14:12:00.000Z" },
      { id: "sample-message-sam", conversation_id: "sample-conversation-sam", direction: "inbound", body: "I’ve sent the website brief over. Let me know what you think when you’ve had a chance to read it.", status: "received", approval_id: null, metadata: {}, created_at: "2027-02-23T18:00:00.000Z" },
      ...data.connectedData!.messages.filter((item) => item.id.startsWith("sample-sent-")).map((item) => ({ id: item.id, conversation_id: item.threadId === "sample-jayden-booking" ? "sample-conversation-jayden" : "sample-conversation-jamie", direction: "outbound" as const, body: item.preview, status: "sent", approval_id: null, metadata: {}, created_at: item.receivedAt ?? data.generatedAt })),
    ],
    contacts: [
      { id: "sample-contact-jayden", first_name: "Jayden", last_name: "Ellis", email: "jayden@example.invalid", phone: null },
      { id: "sample-contact-jamie", first_name: "Jamie", last_name: "Morgan", email: "jamie@example.invalid", phone: null },
      { id: "sample-contact-sam", first_name: "Sam", last_name: "Rivera", email: "sam@example.invalid", phone: null },
    ],
    events: [],
    selectedId: "sample-conversation-jayden",
    canWrite: false,
    enabled: true,
    hasMore: false,
  };
}

export function sampleManagerSnapshot(data: DailyBriefData): ManagerChatSnapshot {
  return {
    messages: [
      {
        id: "sample-manager-morning",
        request: "Get my morning organized",
        status: "completed",
        summary: "The agent team sorted customer requests, checked the calendar, prepared two replies, and followed up on an overdue invoice. Decisions waiting for you are on Today.",
        createdAt: "2027-02-24T13:30:00.000Z",
        assignments: data.work.slice(0, 3).map((item) => ({ id: item.id, title: item.title, status: "completed", summary: item.summary })),
      },
    ],
    active: true,
    aiConfigured: false,
    canWrite: false,
    hasMore: false,
  };
}
