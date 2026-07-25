import type { SupabaseClient } from "@supabase/supabase-js";

import type { ClientBusinessRecord } from "@/lib/clients/constants";
import {
  enabledCapabilityKeys,
  type CapabilityKey,
} from "@/lib/packages/capabilities";
import type { PartnerPackageRecord } from "@/lib/packages/requirements";

// ---------------------------------------------------------------------------
// Staff Assistant Console context (docs/15).
//
// This module is the CONTRACT between Northstar's data and the assistant
// surface. The current surface is a web page inside the partner app, but the
// same AssistantContext is designed to be serialized to a future desktop
// tray app, browser extension, or CRM-native overlay — those runtimes render
// the same object; only the window chrome changes. Keep it JSON-serializable
// and free of framework types.
// ---------------------------------------------------------------------------

export type AssistantChannel =
  | "phone"
  | "sms"
  | "email"
  | "website_chat"
  | "form"
  | "google_business"
  | "manual"
  | "webhook";

export type AssistantActionKey =
  | "send_sms"
  | "send_email"
  | "book_appointment"
  | "add_crm_note"
  | "sync_to_crm"
  | "create_task"
  | "mark_spam"
  | "escalate"
  | "copy_fallback";

// Honest action states. Every button always says exactly why it is or is
// not clickable.
export type AssistantActionState =
  | "works_now"
  | "dry_run"
  | "requires_connection"
  | "waiting"
  | "not_in_package";

export type AssistantAction = {
  key: AssistantActionKey;
  label: string;
  state: AssistantActionState;
  // Short chip text: "Works now", "Dry run", "Requires Twilio", …
  stateLabel: string;
  // One plain sentence of why/what happens.
  detail: string;
  // Set when the action is a navigation (e.g. review in Approvals).
  href: string | null;
  // Whether the console should let the user activate it.
  enabled: boolean;
};

export type AssistantInteraction = {
  channel: AssistantChannel;
  channelLabel: string;
  eventType: string;
  receivedAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactAddress: string | null;
  message: string | null;
};

export type AssistantContextData = {
  mode: "live" | "idle";
  clientId: string;
  clientName: string;
  // Route prefix for in-app links; differs between the partner workspace
  // and the client portal so the same console works for both audiences.
  basePath: string;
  packageName: string | null;
  interaction: AssistantInteraction | null;
  transcript: {
    role: "caller" | "staff" | "ai_assistant";
    content: string;
    at: string;
  }[];
  routing: {
    category: string;
    urgency: string;
    confidence: string;
    summary: string;
    suggestedNextAction: string;
    recommendedOwner: string;
    requiresHandoff: boolean;
    source: "ai" | "fallback";
  } | null;
  analysis: {
    urgency: string;
    quality: string;
    missingFields: string[];
    recommendedNextAction: string;
    suggestedTaskTitle: string | null;
    source: "ai" | "fallback";
  } | null;
  draft: {
    channel: string;
    to: string | null;
    subject: string | null;
    body: string;
    approvalId: string | null;
    approvalStatus: string | null;
  } | null;
  crm: {
    status: "synced" | "dry_run" | "failed" | "skipped" | "none";
    contactId: string | null;
    detail: string;
  };
  // Real booking proposal (from calendar availability) when one exists.
  booking: {
    approvalId: string;
    status: string;
    slotLabel: string;
    alternatives: string[];
  } | null;
  slots: { label: string; startIso: string }[];
  slotsNote: string;
  actions: AssistantAction[];
  recentActivity: {
    at: string;
    kind: "run" | "approval" | "audit" | "assistant_event";
    title: string;
    detail: string | null;
  }[];
  hasLeadBearingRun: boolean;
};

type ConnectionInfo = {
  connected: boolean;
  live: boolean;
};

type RunRow = {
  id: string;
  status: string;
  summary: string | null;
  started_at: string | null;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: Record<string, unknown> | null;
  template: { template_key: string; name: string } | null;
};

type CallRow = {
  id: string;
  status: string;
  from_number: string | null;
  started_at: string;
  extracted: Record<string, unknown> | null;
};

type TranscriptRow = {
  call_session_id: string;
  role: string;
  content: string;
  occurred_at: string;
};

const CHANNEL_BY_EVENT_PREFIX: [string, AssistantChannel, string][] = [
  ["chat.", "website_chat", "Website chat"],
  ["sms.", "sms", "SMS"],
  ["email.", "email", "Email"],
  ["call.", "phone", "Phone"],
  ["missed_call.", "phone", "Phone (missed call)"],
  ["gbp.", "google_business", "Google Business"],
  ["manual.", "manual", "Manual entry"],
  ["form.", "form", "Website form"],
  ["lead.", "form", "Website form / lead"],
];

function channelForEvent(eventType: string): {
  channel: AssistantChannel;
  label: string;
} {
  for (const [prefix, channel, label] of CHANNEL_BY_EVENT_PREFIX) {
    if (eventType.startsWith(prefix)) {
      return { channel, label };
    }
  }

  return { channel: "webhook", label: "Webhook" };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildActions(input: {
  base: string;
  canManageSetup: boolean;
  capabilities: Set<CapabilityKey>;
  crmConn: ConnectionInfo;
  smsConn: ConnectionInfo;
  calendarConn: ConnectionInfo;
  emailConn: ConnectionInfo;
  pendingSmsApprovalId: string | null;
  pendingEmailApprovalId: string | null;
  pendingBookingApprovalId: string | null;
  hasDraft: boolean;
  hasLeadBearingRun: boolean;
}): AssistantAction[] {
  const {
    base,
    canManageSetup,
    capabilities,
    crmConn,
    smsConn,
    calendarConn,
    emailConn,
    pendingSmsApprovalId,
    pendingEmailApprovalId,
    pendingBookingApprovalId,
    hasDraft,
    hasLeadBearingRun,
  } = input;

  const notInPackage = (key: AssistantActionKey, label: string): AssistantAction => ({
    key,
    label,
    state: "not_in_package",
    stateLabel: "Not in this package",
    detail: "The selected package does not include this capability.",
    href: null,
    enabled: false,
  });

  const actions: AssistantAction[] = [];

  // Send SMS — real, but strictly through the approval gate.
  if (!capabilities.has("approval_gated_sending")) {
    actions.push(notInPackage("send_sms", "Send SMS"));
  } else if (!smsConn.connected) {
    actions.push({
      key: "send_sms",
      label: "Send SMS",
      state: "requires_connection",
      stateLabel: "Requires Twilio",
      detail: canManageSetup
        ? "Connect Twilio in the Setup checklist to send approved texts."
        : "Ask your provider to connect SMS sending.",
      href: canManageSetup ? `${base}/setup` : null,
      enabled: canManageSetup,
    });
  } else {
    actions.push({
      key: "send_sms",
      label: "Send SMS",
      state: smsConn.live ? "works_now" : "dry_run",
      stateLabel: smsConn.live ? "Works now" : "Dry run",
      detail: pendingSmsApprovalId
        ? smsConn.live
          ? "A draft is waiting — approving it sends the real SMS."
          : "A draft is waiting — approving it records a dry run (switch Twilio to live to send for real)."
        : "Sends happen only through approved drafts. No draft is waiting right now.",
      href: pendingSmsApprovalId ? `${base}/approvals` : null,
      enabled: Boolean(pendingSmsApprovalId),
    });
  }

  // Send email — real via the approval gate, delivered through Resend.
  if (!capabilities.has("approval_gated_sending")) {
    actions.push(notInPackage("send_email", "Send email"));
  } else if (!emailConn.connected) {
    actions.push({
      key: "send_email",
      label: "Send email",
      state: "requires_connection",
      stateLabel: "Requires email provider",
      detail: canManageSetup
        ? "Connect Resend Email in the Setup checklist to send approved emails."
        : "Ask your provider to connect email sending.",
      href: canManageSetup ? `${base}/setup` : null,
      enabled: canManageSetup,
    });
  } else {
    actions.push({
      key: "send_email",
      label: "Send email",
      state: emailConn.live ? "works_now" : "dry_run",
      stateLabel: emailConn.live ? "Works now" : "Dry run",
      detail: pendingEmailApprovalId
        ? emailConn.live
          ? "An email draft is waiting — approving it sends the real email."
          : "An email draft is waiting — approving it records a dry run (switch Resend to live to send for real)."
        : "Sends happen only through approved drafts. No email draft is waiting right now.",
      href: pendingEmailApprovalId ? `${base}/approvals` : null,
      enabled: Boolean(pendingEmailApprovalId),
    });
  }

  // Book appointment — calendar contract is real, booking workflow is not.
  if (!capabilities.has("appointment_booking")) {
    actions.push(notInPackage("book_appointment", "Book appointment"));
  } else if (!calendarConn.connected) {
    actions.push({
      key: "book_appointment",
      label: "Book appointment",
      state: "requires_connection",
      stateLabel: "Requires Google Calendar",
      detail: canManageSetup
        ? "Connect Google Calendar in the Setup checklist first."
        : "Ask your provider to connect the calendar.",
      href: canManageSetup ? `${base}/setup` : null,
      enabled: canManageSetup,
    });
  } else if (pendingBookingApprovalId) {
    actions.push({
      key: "book_appointment",
      label: "Book appointment",
      state: calendarConn.live ? "works_now" : "dry_run",
      stateLabel: calendarConn.live ? "Works now" : "Dry run",
      detail: calendarConn.live
        ? "A slot proposal from real availability is waiting — approving it books the calendar event."
        : "A slot proposal is waiting — approving records a dry run (switch the calendar to live to book for real).",
      href: `${base}/approvals`,
      enabled: true,
    });
  } else {
    actions.push({
      key: "book_appointment",
      label: "Book appointment",
      state: "works_now",
      stateLabel: "Works now",
      detail:
        "Scheduling requests automatically propose real open slots for approval. No proposal is waiting right now.",
      href: null,
      enabled: false,
    });
  }

  // Add CRM note — real, but automatic (attached with every sync).
  if (!capabilities.has("crm_sync")) {
    actions.push(notInPackage("add_crm_note", "Add CRM note"));
  } else if (!crmConn.connected) {
    actions.push({
      key: "add_crm_note",
      label: "Add CRM note",
      state: "requires_connection",
      stateLabel: "Requires CRM",
      detail: canManageSetup
        ? "Connect a CRM in the Setup checklist first."
        : "Ask your provider to connect the CRM.",
      href: canManageSetup ? `${base}/setup` : null,
      enabled: canManageSetup,
    });
  } else {
    actions.push({
      key: "add_crm_note",
      label: "Add CRM note",
      state: "works_now",
      stateLabel: "Works now",
      detail:
        "An \"AI Assistant\" note is attached automatically with every CRM sync — use Sync to CRM to push the latest.",
      href: null,
      enabled: false,
    });
  }

  // Sync to CRM — real manual action (re-runs the additive contact+note sync).
  if (!capabilities.has("crm_sync")) {
    actions.push(notInPackage("sync_to_crm", "Sync to CRM"));
  } else if (!crmConn.connected) {
    actions.push({
      key: "sync_to_crm",
      label: "Sync to CRM",
      state: "requires_connection",
      stateLabel: "Requires CRM",
      detail: canManageSetup
        ? "Connect a CRM in the Setup checklist first."
        : "Ask your provider to connect the CRM.",
      href: canManageSetup ? `${base}/setup` : null,
      enabled: canManageSetup,
    });
  } else {
    actions.push({
      key: "sync_to_crm",
      label: "Sync to CRM",
      state: crmConn.live ? "works_now" : "dry_run",
      stateLabel: crmConn.live ? "Works now" : "Dry run",
      detail: hasLeadBearingRun
        ? crmConn.live
          ? "Pushes the latest lead's contact + AI note to HubSpot again (additive only)."
          : "Rebuilds the exact HubSpot payload as a dry run — switch HubSpot to live to sync for real."
        : "No lead has come through yet, so there is nothing to sync.",
      href: null,
      enabled: hasLeadBearingRun,
    });
  }

  // Create task — real: writes the AI-suggested follow-up task into the
  // built-in CRM task list.
  actions.push({
    key: "create_task",
    label: "Create task",
    state: hasLeadBearingRun ? "works_now" : "waiting",
    stateLabel: hasLeadBearingRun ? "Works now" : "No lead yet",
    detail: hasLeadBearingRun
      ? "Creates the AI-suggested follow-up task for the latest lead in Northstar's task list."
      : "Appears once a lead has come through — the AI suggests the task.",
    href: null,
    enabled: hasLeadBearingRun,
  });

  // Mark spam/low-value — real: closes the latest lead as low-value.
  actions.push({
    key: "mark_spam",
    label: "Mark spam / low-value",
    state: hasLeadBearingRun ? "works_now" : "waiting",
    stateLabel: hasLeadBearingRun ? "Works now" : "No lead yet",
    detail: hasLeadBearingRun
      ? "Closes the latest lead as spam/low-value and records it in the audit trail."
      : "Appears once a lead has come through.",
    href: null,
    enabled: hasLeadBearingRun,
  });

  // Escalate — real: records an escalation in the audit trail.
  actions.push({
    key: "escalate",
    label: "Escalate",
    state: hasLeadBearingRun ? "works_now" : "waiting",
    stateLabel: hasLeadBearingRun ? "Works now" : "No interaction yet",
    detail: hasLeadBearingRun
      ? "Flags this interaction for a manager and records the escalation in the audit trail."
      : "Available when a customer interaction needs attention.",
    href: null,
    enabled: hasLeadBearingRun,
  });

  // Copy fallback — real whenever a draft exists.
  actions.push({
    key: "copy_fallback",
    label: "Copy fallback",
    state: hasDraft ? "works_now" : "waiting",
    stateLabel: hasDraft ? "Works now" : "No draft yet",
    detail: hasDraft
      ? "Copies the draft text so you can paste it into any tool — the fallback when a provider is not connected."
      : "Appears once the AI has drafted a message for this client.",
    href: null,
    enabled: hasDraft,
  });

  return actions;
}

export async function buildAssistantContext(
  supabase: SupabaseClient,
  client: ClientBusinessRecord,
  options?: { audience?: "partner" | "client" },
): Promise<AssistantContextData> {
  const audience = options?.audience ?? "partner";
  const base = audience === "client" ? "/client" : `/partner/clients/${client.id}`;

  const [
    { data: packageData },
    { data: connectionsData },
    { data: runsData },
    { data: approvalsData },
    { data: auditData },
    { data: assistantEventsData },
    { data: callsData },
    { data: transcriptData },
  ] = await Promise.all([
    client.package_id
      ? supabase
          .from("partner_packages")
          .select("*")
          .eq("id", client.package_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("integration_connections")
      .select(
        "id, status, runtime_mode, provider:integration_providers(provider_key, category, supports_inbound)",
      )
      .eq("client_id", client.id),
    supabase
      .from("workflow_runs")
      .select(
        "id, status, summary, started_at, input_snapshot, output_snapshot, template:workflow_templates(template_key, name)",
      )
      .eq("client_id", client.id)
      .order("started_at", { ascending: false })
      .limit(10),
    supabase
      .from("approval_items")
      .select("id, status, type, title, editable_content, proposed_payload, created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("audit_events")
      .select("created_at, action, summary")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(6),
    supabase
      .from("assistant_events")
      .select("created_at, event_type, payload")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(8),
    supabase
      .from("call_sessions")
      .select("id, status, from_number, started_at, extracted")
      .eq("client_id", client.id)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("call_transcript_turns")
      .select("call_session_id, role, content, occurred_at")
      .eq("client_id", client.id)
      .order("occurred_at", { ascending: false })
      .limit(40),
  ]);

  const pkg = packageData as PartnerPackageRecord | null;
  const capabilities = new Set<CapabilityKey>(
    pkg ? enabledCapabilityKeys(pkg.capabilities) : [],
  );
  const connections = (connectionsData ?? []) as unknown as {
    status: string;
    runtime_mode: string;
    provider: { provider_key: string; category: string } | null;
  }[];

  const connFor = (providerKey: string): ConnectionInfo => {
    const connection = connections.find(
      (candidate) =>
        candidate.provider?.provider_key === providerKey &&
        ["connected", "needs_attention"].includes(candidate.status),
    );

    return {
      connected: Boolean(connection),
      live: connection?.runtime_mode === "live",
    };
  };

  const connForCategory = (category: string): ConnectionInfo => {
    const connection = connections.find(
      (candidate) =>
        candidate.provider?.category === category &&
        ["connected", "needs_attention"].includes(candidate.status),
    );

    return {
      connected: Boolean(connection),
      live: connection?.runtime_mode === "live",
    };
  };

  const crmConn = connForCategory("crm");
  const smsConn = connFor("twilio");
  const calendarConn = connFor("google_calendar");
  const emailConn = connFor("resend");

  const runs = (runsData ?? []) as unknown as RunRow[];

  // Latest run drives the "active interaction" panel; the routing/analysis
  // panels come from the latest run of their producing template.
  const latestRun = runs[0] ?? null;
  const routerRun = runs.find(
    (run) => run.template?.template_key === "ai_intake_router",
  );
  const analysisRun = runs.find(
    (run) => run.template?.template_key === "new_lead_intake",
  );
  const leadBearingRun = runs.find((run) =>
    ["new_lead_intake", "ai_intake_router"].includes(
      run.template?.template_key ?? "",
    ),
  );
  const latestCall = ((callsData ?? []) as CallRow[])[0] ?? null;
  const activeCall = latestCall?.status === "in_progress" ? latestCall : null;
  const activeCallTurns = activeCall
    ? ((transcriptData ?? []) as TranscriptRow[])
        .filter((turn) => turn.call_session_id === activeCall.id)
        .sort((a, b) => (a.occurred_at > b.occurred_at ? 1 : -1))
    : [];

  const mode: AssistantContextData["mode"] =
    latestRun || activeCall ? "live" : "idle";

  let interaction: AssistantInteraction | null = null;

  if (activeCall) {
    const extracted = activeCall.extracted ?? {};
    const collected =
      typeof extracted.voice_collected === "object" &&
      extracted.voice_collected !== null
        ? (extracted.voice_collected as Record<string, unknown>)
        : {};
    const latestCallerTurn = [...activeCallTurns]
      .reverse()
      .find((turn) => turn.role === "caller");

    interaction = {
      channel: "phone",
      channelLabel: "Live phone call",
      eventType: "call.in_progress",
      receivedAt: activeCall.started_at,
      contactName: asString(collected.name),
      contactPhone: asString(collected.phone) ?? activeCall.from_number,
      contactEmail: asString(collected.email),
      contactAddress: asString(collected.address),
      message: latestCallerTurn?.content ?? null,
    };
  } else if (latestRun) {
    const input = latestRun.input_snapshot ?? {};
    const eventType = asString(input.event_type) ?? "event";
    const data = (input.data ?? {}) as Record<string, unknown>;
    const { channel, label } = channelForEvent(eventType);

    interaction = {
      channel,
      channelLabel: label,
      eventType,
      receivedAt: latestRun.started_at,
      contactName: asString(data.name) ?? asString(data.full_name),
      contactPhone: asString(data.phone),
      contactEmail: asString(data.email),
      contactAddress: asString(data.address),
      message: asString(data.message) ?? asString(data.notes),
    };
  }

  // Routing panel.
  let routing: AssistantContextData["routing"] = null;
  const routingOutput = (
    routerRun?.output_snapshot?.output as
      | { routing?: Record<string, unknown> }
      | undefined
  )?.routing;

  if (routingOutput) {
    const ai = routerRun?.output_snapshot?.ai as { status?: string } | null;

    routing = {
      category: asString(routingOutput.category) ?? "other",
      urgency: asString(routingOutput.urgency) ?? "medium",
      confidence: asString(routingOutput.confidence) ?? "low",
      summary: asString(routingOutput.summary) ?? "",
      suggestedNextAction:
        asString(routingOutput.suggested_next_action) ?? "",
      recommendedOwner: asString(routingOutput.recommended_owner) ?? "",
      requiresHandoff: routingOutput.requires_human_handoff === true,
      source: ai?.status === "ai" ? "ai" : "fallback",
    };
  }

  // Lead analysis panel.
  let analysis: AssistantContextData["analysis"] = null;
  const analysisOutput = (
    analysisRun?.output_snapshot?.output as
      | { analysis?: Record<string, unknown> }
      | undefined
  )?.analysis;

  if (analysisOutput) {
    const ai = analysisRun?.output_snapshot?.ai as { status?: string } | null;
    const suggestedTask = analysisOutput.suggested_task as
      | { title?: string }
      | undefined;

    analysis = {
      urgency: asString(analysisOutput.urgency) ?? "medium",
      quality: asString(analysisOutput.lead_quality) ?? "warm",
      missingFields: Array.isArray(analysisOutput.missing_fields)
        ? (analysisOutput.missing_fields as unknown[])
            .map((field) => asString(field))
            .filter((field): field is string => Boolean(field))
        : [],
      recommendedNextAction:
        asString(analysisOutput.recommended_next_action) ?? "",
      suggestedTaskTitle: asString(suggestedTask?.title),
      source: ai?.status === "ai" ? "ai" : "fallback",
    };
  } else if (activeCall) {
    const extracted = activeCall.extracted ?? {};
    const collected =
      typeof extracted.voice_collected === "object" &&
      extracted.voice_collected !== null
        ? (extracted.voice_collected as Record<string, unknown>)
        : {};
    const missingFields = [
      ["customer name", collected.name],
      ["service need", collected.service_need],
      ["address", collected.address],
      ["appointment preference", collected.appointment_preference],
    ]
      .filter(([, value]) => !asString(value))
      .map(([label]) => label as string);

    analysis = {
      urgency: asString(collected.urgency) ?? "medium",
      quality: "unreviewed",
      missingFields,
      recommendedNextAction:
        missingFields.length > 0
          ? `Ask for ${missingFields.slice(0, 2).join(" and ")}.`
          : "Review the captured details and confirm the next step.",
      suggestedTaskTitle: null,
      source: "fallback",
    };
  }

  // Draft panel: prefer a pending customer-message approval (that is the
  // draft a human can act on right now).
  const approvals = (approvalsData ?? []) as unknown as {
    id: string;
    status: string;
    type: string;
    editable_content: string | null;
    proposed_payload: Record<string, unknown> | null;
  }[];

  const pendingApproval = approvals.find(
    (approval) =>
      approval.type === "customer_message" && approval.status === "pending",
  );
  const latestApproval = approvals.find(
    (approval) => approval.type === "customer_message",
  );
  const draftApproval = pendingApproval ?? latestApproval ?? null;

  let draft: AssistantContextData["draft"] = null;

  if (draftApproval?.editable_content) {
    const payload = draftApproval.proposed_payload ?? {};

    draft = {
      channel: asString(payload.channel) ?? "sms",
      to: asString(payload.to),
      subject: asString(payload.subject),
      body: draftApproval.editable_content,
      approvalId: draftApproval.id,
      approvalStatus: draftApproval.status,
    };
  }

  // CRM sync status from the latest lead-bearing run's crm snapshot.
  const crmSnapshot = leadBearingRun?.output_snapshot?.crm as
    | { status?: string; contact_id?: string }
    | undefined;
  const crmStatus = (crmSnapshot?.status ?? "none") as
    | "synced"
    | "dry_run"
    | "failed"
    | "skipped"
    | "none";

  const crm: AssistantContextData["crm"] = {
    status: crmSnapshot ? crmStatus : "none",
    contactId: asString(crmSnapshot?.contact_id),
    detail: !capabilities.has("crm_sync")
      ? "CRM sync is not part of this package."
      : !crmConn.connected
        ? "No CRM connected — contacts stay in Northstar only."
        : crmStatus === "synced"
          ? `Contact is in HubSpot${crmSnapshot?.contact_id ? ` (${crmSnapshot.contact_id})` : ""} with an AI Assistant note.`
          : crmStatus === "dry_run"
            ? "Dry run — the exact HubSpot payload was built but not sent. Switch HubSpot to live to sync for real."
            : crmStatus === "failed"
              ? "The last CRM sync failed — check the HubSpot connection in Setup."
              : crmStatus === "skipped"
                ? "Sync skipped — the lead had no email or phone to match on."
                : "No lead has synced yet.",
  };

  const pendingSmsApprovalId =
    pendingApproval &&
    asString(pendingApproval.proposed_payload?.channel) !== "email"
      ? pendingApproval.id
      : null;
  const pendingEmailApprovalId =
    pendingApproval &&
    asString(pendingApproval.proposed_payload?.channel) === "email"
      ? pendingApproval.id
      : null;

  // Real booking proposal (approval-gated, built from calendar free/busy).
  const bookingApproval = approvals.find(
    (approval) => approval.type === "appointment_booking",
  );
  let booking: AssistantContextData["booking"] = null;
  let realSlots: { label: string; startIso: string }[] = [];

  if (bookingApproval) {
    const payload = bookingApproval.proposed_payload ?? {};
    const slot = (payload.slot ?? {}) as { label?: string; start_iso?: string };
    const alternatives = Array.isArray(payload.alternatives)
      ? (payload.alternatives as { label?: string; start_iso?: string }[])
      : [];

    booking = {
      approvalId: bookingApproval.id,
      status: bookingApproval.status,
      slotLabel: slot.label ?? "proposed slot",
      alternatives: alternatives
        .map((alternative) => alternative.label)
        .filter((label): label is string => Boolean(label)),
    };

    realSlots = [slot, ...alternatives]
      .filter(
        (candidate): candidate is { label: string; start_iso: string } =>
          Boolean(candidate.label && candidate.start_iso),
      )
      .map((candidate) => ({
        label: candidate.label,
        startIso: candidate.start_iso,
      }));
  }

  const activeCallSlots =
    activeCall && Array.isArray(activeCall.extracted?.proposed_slots)
      ? (
          activeCall.extracted?.proposed_slots as {
            label?: unknown;
            start_iso?: unknown;
          }[]
        )
          .map((slot) => ({
            label: asString(slot.label),
            startIso: asString(slot.start_iso),
          }))
          .filter(
            (slot): slot is { label: string; startIso: string } =>
              Boolean(slot.label && slot.startIso),
          )
      : [];

  const actions = buildActions({
    base,
    canManageSetup: audience === "partner",
    capabilities,
    crmConn,
    smsConn,
    calendarConn,
    emailConn,
    pendingSmsApprovalId,
    pendingEmailApprovalId,
    pendingBookingApprovalId:
      bookingApproval?.status === "pending" ? bookingApproval.id : null,
    hasDraft: Boolean(draft),
    hasLeadBearingRun: Boolean(leadBearingRun),
  });

  // Recent activity: runs + audit + live assistant events interleaved,
  // newest first.
  const recentActivity: AssistantContextData["recentActivity"] = [
    ...runs.slice(0, 5).map((run) => ({
      at: run.started_at ?? "",
      kind: "run" as const,
      title: run.template?.name ?? "Workflow run",
      detail: run.summary,
    })),
    ...((auditData ?? []) as { created_at: string; action: string; summary: string | null }[]).map(
      (event) => ({
        at: event.created_at,
        kind: "audit" as const,
        title: event.action.replaceAll(".", " ").replaceAll("_", " "),
        detail: event.summary,
      }),
    ),
    ...((assistantEventsData ?? []) as {
      created_at: string;
      event_type: string;
      payload: Record<string, unknown> | null;
    }[]).map((event) => ({
      at: event.created_at,
      kind: "assistant_event" as const,
      title: event.event_type.replaceAll("_", " "),
      detail:
        typeof event.payload?.title === "string"
          ? (event.payload.title as string)
          : null,
    })),
  ]
    .filter((item) => item.at)
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 10);

  const slots = activeCallSlots.length > 0 ? activeCallSlots : realSlots;
  let slotsNote =
    "Calendar availability will appear after your provider connects a calendar.";

  if (activeCallSlots.length > 0) {
    slotsNote = "Current availability matched to the customer's request.";
  } else if (realSlots.length > 0) {
    slotsNote =
      booking?.status === "pending"
        ? "Real availability from the connected calendar. Approving the booking proposal books the first slot."
        : "Real availability from the connected calendar (proposal already resolved).";
  } else if (calendarConn.connected) {
    slotsNote = "Open slots will appear when a customer asks to schedule.";
  }

  return {
    mode,
    clientId: client.id,
    clientName: client.name,
    basePath: base,
    packageName: pkg?.name ?? null,
    interaction,
    transcript: activeCallTurns
      .filter(
        (
          turn,
        ): turn is TranscriptRow & {
          role: "caller" | "staff" | "ai_assistant";
        } => ["caller", "staff", "ai_assistant"].includes(turn.role),
      )
      .map((turn) => ({
        role: turn.role,
        content: turn.content,
        at: turn.occurred_at,
      })),
    routing,
    analysis,
    draft,
    crm,
    booking,
    slots,
    slotsNote,
    actions,
    recentActivity,
    hasLeadBearingRun: Boolean(leadBearingRun),
  };
}
