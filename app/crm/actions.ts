"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { redactAuditValue } from "@/lib/audit/redact";
import { resolveAssistantAccess } from "@/lib/assistant/access";
import { getAuthState } from "@/lib/auth/session";
import {
  analyzeCrmFeedback,
  analyzeManualLead,
  buildBallparkQuote,
  draftCrmMessage,
  type DraftObjective,
} from "@/lib/crm/intelligence";
import {
  buildAppointmentTiming,
  CRM_APPOINTMENT_STATUSES,
  type CrmAppointmentStatus,
} from "@/lib/crm/appointments";
import type { FormState } from "@/lib/forms/state";
import { isAccessError } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runWorkflowsForEvent } from "@/lib/workflows/engine";

type ActionContext = {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  access: Awaited<ReturnType<typeof resolveAssistantAccess>>;
  partnerId: string;
  clientId: string;
  clientName: string;
};

function clean(value: unknown, max = 1000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validUuid(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{36}$/i.test(value));
}

function result(message: string, status: "success" | "error" = "success"): FormState {
  return { status, message };
}

function revalidateCrm(clientId: string) {
  revalidatePath("/client");
  revalidatePath("/client/crm");
  revalidatePath("/client/assistant");
  revalidatePath("/client/approvals");
  revalidatePath(`/partner/clients/${clientId}`);
  revalidatePath(`/partner/clients/${clientId}/crm`);
  revalidatePath(`/partner/clients/${clientId}/assistant`);
  revalidatePath(`/partner/clients/${clientId}/approvals`);
}

async function actionContext(
  clientId: string,
  operation: "crm_edit" | "customer_action",
): Promise<ActionContext | FormState> {
  const auth = await getAuthState();

  if (!auth.user || !validUuid(clientId)) {
    return result("Sign in to use the CRM.", "error");
  }

  try {
    const access = await resolveAssistantAccess(auth.user.id, clientId, "write");

    if (
      (operation === "crm_edit" && !access.canEditCrmData) ||
      (operation === "customer_action" &&
        !access.canOperateCustomerActions)
    ) {
      return result(
        "This workspace is read-only for your role. Use an account with customer-action access to continue.",
        "error",
      );
    }

    const admin = createSupabaseAdminClient();

    if (!admin || !access.partnerId) {
      return result("The data service is unavailable.", "error");
    }

    const { data: client } = await admin
      .from("client_businesses")
      .select("name")
      .eq("id", clientId)
      .eq("partner_id", access.partnerId)
      .maybeSingle();

    if (!client) {
      return result("Business workspace not found.", "error");
    }

    return {
      admin,
      access,
      partnerId: access.partnerId,
      clientId,
      clientName: client.name,
    };
  } catch (error) {
    if (isAccessError(error)) {
      return result(
        error.code === "ACCESS_DENIED"
          ? "You do not have permission to operate this CRM."
          : "Access checks are unavailable right now.",
        "error",
      );
    }

    throw error;
  }
}

async function addTimeline(
  context: ActionContext,
  input: {
    contactId?: string | null;
    leadId?: string | null;
    kind: "note" | "message" | "task" | "appointment" | "system";
    title: string;
    body?: string | null;
  },
) {
  await context.admin.from("crm_timeline_entries").insert({
    partner_id: context.partnerId,
    client_id: context.clientId,
    contact_id: validUuid(input.contactId) ? input.contactId : null,
    lead_id: validUuid(input.leadId) ? input.leadId : null,
    kind: input.kind,
    actor_type: "user",
    actor_user_id: context.access.userId,
    title: input.title,
    body: input.body ?? null,
  });
}

async function resolveCrmLinks(
  context: ActionContext,
  input: { contactId?: string; leadId?: string },
) {
  let contactId = validUuid(input.contactId) ? input.contactId : null;
  let leadId = validUuid(input.leadId) ? input.leadId : null;

  if (leadId) {
    const { data: lead } = await context.admin
      .from("crm_leads")
      .select("id, contact_id")
      .eq("id", leadId)
      .eq("client_id", context.clientId)
      .maybeSingle();

    if (!lead) {
      leadId = null;
    } else {
      contactId = lead.contact_id;
    }
  } else if (contactId) {
    const { data: contact } = await context.admin
      .from("crm_contacts")
      .select("id")
      .eq("id", contactId)
      .eq("client_id", context.clientId)
      .maybeSingle();

    if (!contact) contactId = null;
  }

  return { contactId, leadId };
}

async function audit(
  context: ActionContext,
  action: string,
  targetType: string,
  targetId: string | null,
  summary: string,
) {
  await recordAuditEvent({
    actor: context.access,
    action,
    targetType,
    targetId,
    summary,
    metadata: { source: "northstar_crm" },
  });
}

async function findAppointmentConflict(
  context: ActionContext,
  timing: { start: Date; end: Date },
  excludeAppointmentId?: string,
) {
  let query = context.admin
    .from("crm_appointments")
    .select("id, title, start_at, end_at")
    .eq("client_id", context.clientId)
    .in("status", ["proposed", "booked"])
    .lt("start_at", timing.end.toISOString())
    .gt("end_at", timing.start.toISOString())
    .order("start_at", { ascending: true })
    .limit(1);

  if (excludeAppointmentId) {
    query = query.neq("id", excludeAppointmentId);
  }

  const { data } = await query.maybeSingle();
  return data ?? null;
}

export async function createCrmLead(input: {
  clientId: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  serviceType?: string;
  description?: string;
  source?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const name = clean(input.name, 200);
  const phone = clean(input.phone, 80);
  const email = clean(input.email, 240).toLowerCase();
  const address = clean(input.address, 300);
  const serviceType = clean(input.serviceType, 160) || "Not specified";
  const description = clean(input.description, 4000);
  const source = clean(input.source, 120) || "manual";

  if (!name || (!phone && !email)) {
    return result("Add a name and at least a phone number or email.", "error");
  }

  const parts = name.split(/\s+/);
  const firstName = parts.shift() ?? name;
  const lastName = parts.join(" ") || null;
  let contactId: string | null = null;

  if (email) {
    const { data } = await context.admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", context.clientId)
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    contactId = data?.id ?? null;
  }

  if (!contactId && phone) {
    const { data } = await context.admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", context.clientId)
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();
    contactId = data?.id ?? null;
  }

  if (!contactId) {
    const { data, error } = await context.admin
      .from("crm_contacts")
      .insert({
        partner_id: context.partnerId,
        client_id: context.clientId,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        email: email || null,
        address: address || null,
        source,
        created_by: context.access.userId,
      })
      .select("id")
      .single();

    if (error || !data) {
      return result("The contact could not be created.", "error");
    }

    contactId = data.id;
  }

  const leadData = {
    name,
    phone,
    email,
    address,
    service_type: serviceType,
    message: description,
    source,
  };
  const { analysis, ai } = await analyzeManualLead({
    businessName: context.clientName,
    data: leadData,
  });

  const { data: lead, error: leadError } = await context.admin
    .from("crm_leads")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: contactId,
      status: "new",
      title: `${serviceType} — ${name}`,
      service_type: analysis.service_type || serviceType,
      description: description || null,
      source_event_type: "manual.lead_created",
      urgency: analysis.urgency,
      quality: analysis.lead_quality,
      summary: analysis.summary,
      next_action: analysis.recommended_next_action,
    })
    .select("id")
    .single();

  if (leadError || !lead) {
    return result("The lead could not be created.", "error");
  }

  const dueAt = new Date(
    Date.now() + analysis.suggested_task.due_in_minutes * 60_000,
  ).toISOString();

  await Promise.all([
    context.admin.from("crm_tasks").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: contactId,
      lead_id: lead.id,
      title: analysis.suggested_task.title,
      description: analysis.suggested_task.description,
      priority: analysis.suggested_task.priority,
      status: "open",
      due_at: dueAt,
      created_by: context.access.userId,
    }),
    context.admin.from("crm_communications").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: contactId,
      lead_id: lead.id,
      channel: "form",
      direction: "inbound",
      status: "received",
      from_value: name,
      to_value: context.clientName,
      body: description || `${serviceType} inquiry entered manually.`,
      metadata: { source, ai_status: ai.status },
    }),
  ]);

  await addTimeline(context, {
    contactId,
    leadId: lead.id,
    kind: "note",
    title:
      ai.status === "ai"
        ? "AI analyzed the new lead"
        : "Lead analyzed with built-in automation",
    body: `${analysis.summary}\n\nNext: ${analysis.recommended_next_action}`,
  });
  await audit(
    context,
    "crm.lead_created",
    "crm_lead",
    lead.id,
    `Created ${name} as a ${analysis.urgency}-urgency lead.`,
  );

  revalidateCrm(context.clientId);
  return result(
    `Lead created and analyzed (${ai.status === "ai" ? "AI" : "built-in automation"}).`,
  );
}

export async function updateCrmLeadStage(input: {
  clientId: string;
  leadId: string;
  status: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const allowed = ["new", "contacted", "quoted", "scheduled", "won", "lost"];
  if (!validUuid(input.leadId) || !allowed.includes(input.status)) {
    return result("Choose a valid pipeline stage.", "error");
  }

  const { data: lead } = await context.admin
    .from("crm_leads")
    .select("id, contact_id, status")
    .eq("id", input.leadId)
    .eq("client_id", context.clientId)
    .maybeSingle();

  if (!lead) return result("Lead not found.", "error");

  await context.admin
    .from("crm_leads")
    .update({
      status: input.status,
      last_contact_at:
        input.status === "contacted" ? new Date().toISOString() : undefined,
    })
    .eq("id", lead.id);

  await addTimeline(context, {
    contactId: lead.contact_id,
    leadId: lead.id,
    kind: "system",
    title: `Pipeline moved from ${lead.status} to ${input.status}`,
  });
  await audit(
    context,
    "crm.lead_stage_changed",
    "crm_lead",
    lead.id,
    `Moved lead from ${lead.status} to ${input.status}.`,
  );

  revalidateCrm(context.clientId);
  return result(`Lead moved to ${input.status.replaceAll("_", " ")}.`);
}

export async function updateCrmLead(input: {
  clientId: string;
  leadId: string;
  serviceType: string;
  description?: string;
  nextAction?: string;
  estimatedValueMin?: number;
  estimatedValueMax?: number;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.leadId)) return result("Lead not found.", "error");

  const serviceType = clean(input.serviceType, 160);
  if (!serviceType) return result("Add a service type.", "error");

  const valueMin = Math.max(0, Number(input.estimatedValueMin) || 0);
  const valueMax = Math.max(0, Number(input.estimatedValueMax) || 0);
  if (valueMax > 0 && valueMin > valueMax) {
    return result("The low estimate cannot exceed the high estimate.", "error");
  }

  const { data: lead, error } = await context.admin
    .from("crm_leads")
    .update({
      service_type: serviceType,
      description: clean(input.description, 4000) || null,
      next_action: clean(input.nextAction, 1000) || null,
      estimated_value_min: valueMin || null,
      estimated_value_max: valueMax || null,
    })
    .eq("id", input.leadId)
    .eq("client_id", context.clientId)
    .select("id, contact_id")
    .maybeSingle();

  if (error || !lead) return result("The lead could not be updated.", "error");

  await addTimeline(context, {
    contactId: lead.contact_id,
    leadId: lead.id,
    kind: "system",
    title: "Lead details updated",
  });
  await audit(
    context,
    "crm.lead_updated",
    "crm_lead",
    lead.id,
    `Updated the ${serviceType} lead.`,
  );

  revalidateCrm(context.clientId);
  return result("Lead details saved.");
}

export async function updateCrmContact(input: {
  clientId: string;
  contactId: string;
  firstName: string;
  lastName?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  address?: string;
  preferredChannel?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.contactId)) return result("Contact not found.", "error");

  const firstName = clean(input.firstName, 120);
  const phone = clean(input.phone, 80);
  const email = clean(input.email, 240).toLowerCase();
  if (!firstName || (!phone && !email)) {
    return result("Add a first name and a phone number or email.", "error");
  }
  if (email && !email.includes("@")) {
    return result("Enter a valid email address.", "error");
  }

  const preferredChannel = ["phone", "sms", "email"].includes(
    input.preferredChannel ?? "",
  )
    ? input.preferredChannel
    : null;

  const { data: contact, error } = await context.admin
    .from("crm_contacts")
    .update({
      first_name: firstName,
      last_name: clean(input.lastName, 120) || null,
      company_name: clean(input.companyName, 200) || null,
      phone: phone || null,
      email: email || null,
      address: clean(input.address, 300) || null,
      preferred_channel: preferredChannel,
    })
    .eq("id", input.contactId)
    .eq("client_id", context.clientId)
    .select("id")
    .maybeSingle();

  if (error || !contact) {
    return result("The customer record could not be updated.", "error");
  }

  await audit(
    context,
    "crm.contact_updated",
    "crm_contact",
    contact.id,
    `Updated the customer record for ${firstName}.`,
  );
  revalidateCrm(context.clientId);
  return result("Customer information saved.");
}

export async function createCrmTask(input: {
  clientId: string;
  title: string;
  description?: string;
  priority?: string;
  dueAt?: string;
  contactId?: string;
  leadId?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const title = clean(input.title, 300);
  if (!title) return result("Add a task title.", "error");

  const priority = ["urgent", "high", "medium", "low"].includes(
    input.priority ?? "",
  )
    ? input.priority
    : "medium";
  const dueAt =
    input.dueAt && !Number.isNaN(new Date(input.dueAt).getTime())
      ? new Date(input.dueAt).toISOString()
      : null;
  const links = await resolveCrmLinks(context, input);

  const { data: task, error } = await context.admin
    .from("crm_tasks")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: links.contactId,
      lead_id: links.leadId,
      title,
      description: clean(input.description, 2000) || null,
      priority,
      status: "open",
      due_at: dueAt,
      created_by: context.access.userId,
    })
    .select("id")
    .single();

  if (error || !task) return result("The task could not be created.", "error");

  await addTimeline(context, {
    contactId: links.contactId,
    leadId: links.leadId,
    kind: "task",
    title: `Task created: ${title}`,
  });
  revalidateCrm(context.clientId);
  return result("Task created.");
}

export async function setCrmTaskStatus(input: {
  clientId: string;
  taskId: string;
  status: "open" | "done" | "cancelled";
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.taskId)) return result("Task not found.", "error");

  const { error } = await context.admin
    .from("crm_tasks")
    .update({
      status: input.status,
      completed_at: input.status === "done" ? new Date().toISOString() : null,
    })
    .eq("id", input.taskId)
    .eq("client_id", context.clientId);

  if (error) return result("The task could not be updated.", "error");
  revalidateCrm(context.clientId);
  return result(input.status === "done" ? "Task completed." : "Task updated.");
}

export async function setCrmAppointmentStatus(input: {
  clientId: string;
  appointmentId: string;
  status: CrmAppointmentStatus;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.appointmentId)) {
    return result("Appointment not found.", "error");
  }

  if (!CRM_APPOINTMENT_STATUSES.includes(input.status)) {
    return result("Choose a valid appointment status.", "error");
  }

  const { data: existing } = await context.admin
    .from("crm_appointments")
    .select("id, contact_id, lead_id, title, status")
    .eq("id", input.appointmentId)
    .eq("client_id", context.clientId)
    .maybeSingle();

  if (!existing) {
    return result("Appointment not found.", "error");
  }

  const { error } = await context.admin
    .from("crm_appointments")
    .update({ status: input.status })
    .eq("id", input.appointmentId)
    .eq("client_id", context.clientId);

  if (error) {
    return result("The appointment could not be updated.", "error");
  }

  await addTimeline(context, {
    contactId: existing.contact_id,
    leadId: existing.lead_id,
    kind: "appointment",
    title: `${existing.title} marked ${input.status}`,
  });
  await audit(
    context,
    "crm.appointment_status_changed",
    "crm_appointment",
    existing.id,
    `Changed "${existing.title}" from ${existing.status} to ${input.status}.`,
  );
  revalidateCrm(context.clientId);
  return result(`Appointment marked ${input.status}.`);
}

export async function createCrmMessageDraft(input: {
  clientId: string;
  contactId: string;
  leadId?: string;
  objective: DraftObjective;
  channel: "sms" | "email";
  context?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "customer_action");
  if ("status" in context) return context;

  if (!validUuid(input.contactId)) return result("Choose a contact.", "error");

  const { data: contact } = await context.admin
    .from("crm_contacts")
    .select("id, first_name, last_name, phone, email, address")
    .eq("id", input.contactId)
    .eq("client_id", context.clientId)
    .maybeSingle();

  if (!contact) return result("Contact not found.", "error");

  const to = input.channel === "email" ? contact.email : contact.phone;
  if (!to) {
    return result(
      `This contact does not have a${input.channel === "email" ? "n email address" : " phone number"}.`,
      "error",
    );
  }

  const name = [contact.first_name, contact.last_name]
    .filter(Boolean)
    .join(" ");
  const { draft, ai } = await draftCrmMessage({
    businessName: context.clientName,
    objective: input.objective,
    data: {
      name,
      phone: input.channel === "sms" ? contact.phone : null,
      email: input.channel === "email" ? contact.email : null,
      address: contact.address,
      message: clean(input.context, 3000),
    },
  });

  const { data: approval, error: approvalError } = await context.admin
    .from("approval_items")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      type: "customer_message",
      status: "pending",
      title: `${input.channel.toUpperCase()} draft: ${name || to}`,
      summary: `${input.objective.replaceAll("_", " ")} draft created in the CRM. Review before sending.`,
      risk_level: "medium",
      editable_content: draft.body,
      proposed_payload: {
        channel: input.channel,
        to,
        subject: input.channel === "email" ? draft.subject : null,
        contact_id: contact.id,
        lead_id: validUuid(input.leadId) ? input.leadId : null,
        draft_source: ai.status === "ai" ? "ai_generated" : "rule_based_template",
      },
    })
    .select("id")
    .single();

  if (approvalError || !approval) {
    return result("The message draft could not be queued.", "error");
  }

  await context.admin.from("crm_communications").insert({
    partner_id: context.partnerId,
    client_id: context.clientId,
    contact_id: contact.id,
    lead_id: validUuid(input.leadId) ? input.leadId : null,
    approval_id: approval.id,
    channel: input.channel,
    direction: "outbound",
    status: "pending_approval",
    from_value: context.clientName,
    to_value: to,
    subject: input.channel === "email" ? draft.subject : null,
    body: draft.body,
    ai_generated: ai.status === "ai",
    metadata: { objective: input.objective, ai },
  });

  await addTimeline(context, {
    contactId: contact.id,
    leadId: input.leadId,
    kind: "message",
    title: `${input.channel.toUpperCase()} draft queued for approval`,
    body: draft.body,
  });
  await audit(
    context,
    "crm.message_drafted",
    "approval_item",
    approval.id,
    `Prepared an approval-gated ${input.channel.toUpperCase()} draft for ${name || to}.`,
  );

  revalidateCrm(context.clientId);
  return result(
    `Draft created (${ai.status === "ai" ? "AI" : "built-in automation"}) and sent to Approvals.`,
  );
}

export async function receiveCrmCommunication(input: {
  clientId: string;
  channel: "sms" | "email" | "form";
  name?: string;
  phone?: string;
  email?: string;
  message: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "customer_action");
  if ("status" in context) return context;

  const message = clean(input.message, 4000);
  if (!message) return result("Enter the customer message.", "error");

  const data = {
    name: clean(input.name, 200),
    phone: clean(input.phone, 80),
    email: clean(input.email, 240).toLowerCase(),
    message,
    channel: input.channel,
    source: "northstar_crm_test",
  };
  const eventType =
    input.channel === "sms"
      ? "sms.received"
      : input.channel === "email"
        ? "email.received"
        : "form.submitted";
  const requestPayload = redactAuditValue({
    event_type: eventType,
    source: "northstar_crm",
    data,
  });

  const { data: event, error } = await context.admin
    .from("integration_events")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      connection_id: null,
      direction: "inbound",
      event_type: eventType,
      status: "received",
      request_payload: requestPayload,
      redacted: true,
    })
    .select("id")
    .single();

  if (error || !event) {
    return result("The inbound message could not be recorded.", "error");
  }

  try {
    const engine = await runWorkflowsForEvent(context.admin, {
      id: event.id,
      partnerId: context.partnerId,
      clientId: context.clientId,
      connectionId: null,
      eventType,
      data,
    });

    await context.admin
      .from("integration_events")
      .update({
        status: "processed",
        workflow_run_id: engine.runs[0]?.runId ?? null,
      })
      .eq("id", event.id);

    await context.admin.from("crm_communications").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      channel: input.channel,
      direction: "inbound",
      status: "received",
      from_value: data.phone || data.email || data.name || "Customer",
      to_value: context.clientName,
      subject: input.channel === "email" ? "Inbound customer email" : null,
      body: message,
      metadata: { integration_event_id: event.id },
    });

    revalidateCrm(context.clientId);
    return result(
      `Inbound ${input.channel.toUpperCase()} processed through ${engine.runs.length} workflow${engine.runs.length === 1 ? "" : "s"}.`,
    );
  } catch (engineError) {
    await context.admin
      .from("integration_events")
      .update({
        status: "failed",
        error_code: "processing_failed",
        error_message:
          engineError instanceof Error
            ? engineError.message
            : "Workflow processing failed.",
      })
      .eq("id", event.id);

    return result("The message was stored, but workflow processing failed.", "error");
  }
}

export async function createCrmAppointment(input: {
  clientId: string;
  contactId?: string;
  leadId?: string;
  title: string;
  startAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const title = clean(input.title, 300);
  const timing = buildAppointmentTiming(
    input.startAt,
    input.durationMinutes,
  );
  if (!title || !timing) {
    return result("Add an appointment title and valid start time.", "error");
  }

  const conflict = await findAppointmentConflict(context, timing);
  if (conflict) {
    return result(
      `That time overlaps "${conflict.title}". Choose another time or reschedule the existing appointment.`,
      "error",
    );
  }

  const links = await resolveCrmLinks(context, input);

  const { data: appointment, error } = await context.admin
    .from("crm_appointments")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: links.contactId,
      lead_id: links.leadId,
      title,
      start_at: timing.start.toISOString(),
      end_at: timing.end.toISOString(),
      status: "booked",
      location: clean(input.location, 300) || null,
      notes: clean(input.notes, 2000) || null,
      source: "northstar_manual",
    })
    .select("id")
    .single();

  if (error || !appointment) {
    return result("The appointment could not be created.", "error");
  }

  if (links.leadId) {
    await context.admin
      .from("crm_leads")
      .update({ status: "scheduled" })
      .eq("id", links.leadId)
      .eq("client_id", context.clientId);
  }

  await addTimeline(context, {
    contactId: links.contactId,
    leadId: links.leadId,
    kind: "appointment",
    title: `Appointment booked: ${title}`,
    body: timing.start.toLocaleString(),
  });
  await audit(
    context,
    "crm.appointment_created",
    "crm_appointment",
    appointment.id,
    `Booked "${title}" for ${timing.start.toISOString()}.`,
  );
  revalidateCrm(context.clientId);
  return result("Appointment added to the CRM.");
}

export async function updateCrmAppointment(input: {
  clientId: string;
  appointmentId: string;
  title: string;
  startAt: string;
  durationMinutes?: number;
  location?: string;
  notes?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.appointmentId)) {
    return result("Appointment not found.", "error");
  }

  const title = clean(input.title, 300);
  const timing = buildAppointmentTiming(
    input.startAt,
    input.durationMinutes,
  );
  if (!title || !timing) {
    return result("Add an appointment title and valid start time.", "error");
  }

  const { data: existing } = await context.admin
    .from("crm_appointments")
    .select("id, contact_id, lead_id, title, start_at, end_at, status")
    .eq("id", input.appointmentId)
    .eq("client_id", context.clientId)
    .maybeSingle();
  if (!existing) return result("Appointment not found.", "error");

  const conflict = await findAppointmentConflict(
    context,
    timing,
    input.appointmentId,
  );
  if (conflict) {
    return result(
      `That time overlaps "${conflict.title}". Choose another time.`,
      "error",
    );
  }

  const { error } = await context.admin
    .from("crm_appointments")
    .update({
      title,
      start_at: timing.start.toISOString(),
      end_at: timing.end.toISOString(),
      location: clean(input.location, 300) || null,
      notes: clean(input.notes, 2000) || null,
    })
    .eq("id", input.appointmentId)
    .eq("client_id", context.clientId);

  if (error) {
    return result("The appointment could not be rescheduled.", "error");
  }

  const timeChanged =
    existing.start_at !== timing.start.toISOString() ||
    existing.end_at !== timing.end.toISOString();
  await addTimeline(context, {
    contactId: existing.contact_id,
    leadId: existing.lead_id,
    kind: "appointment",
    title: timeChanged
      ? `Appointment rescheduled: ${title}`
      : `Appointment updated: ${title}`,
    body: timing.start.toLocaleString(),
  });
  await audit(
    context,
    timeChanged ? "crm.appointment_rescheduled" : "crm.appointment_updated",
    "crm_appointment",
    existing.id,
    timeChanged
      ? `Rescheduled "${existing.title}" to ${timing.start.toISOString()}.`
      : `Updated appointment "${existing.title}".`,
  );

  revalidateCrm(context.clientId);
  return result(timeChanged ? "Appointment rescheduled." : "Appointment updated.");
}

export async function saveCrmAvailability(input: {
  clientId: string;
  weekday: number;
  startTime: string;
  endTime: string;
  appointmentMinutes?: number;
  label?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const weekday = Math.max(0, Math.min(6, Math.trunc(input.weekday)));
  const timePattern = /^\d{2}:\d{2}$/;
  if (
    !timePattern.test(input.startTime) ||
    !timePattern.test(input.endTime) ||
    input.endTime <= input.startTime
  ) {
    return result("Choose a valid availability window.", "error");
  }

  const { error } = await context.admin
    .from("crm_availability_windows")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      weekday,
      start_time: input.startTime,
      end_time: input.endTime,
      appointment_minutes: Math.min(
        480,
        Math.max(15, input.appointmentMinutes ?? 60),
      ),
      label: clean(input.label, 160) || null,
    });

  if (error) return result("Availability could not be saved.", "error");
  revalidateCrm(context.clientId);
  return result("Availability window saved.");
}

export async function createCrmQuote(input: {
  clientId: string;
  contactId?: string;
  leadId?: string;
  serviceType: string;
  quantity: number;
  complexity: "standard" | "complex" | "premium";
  notes?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const serviceType = clean(input.serviceType, 200);
  if (!serviceType) return result("Add a service type.", "error");

  const quote = buildBallparkQuote({
    serviceType,
    quantity: Number(input.quantity),
    complexity: input.complexity,
  });
  const links = await resolveCrmLinks(context, input);

  const { data, error } = await context.admin
    .from("crm_quotes")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: links.contactId,
      lead_id: links.leadId,
      service_type: serviceType,
      status: "internal_ballpark",
      low_amount: quote.low,
      high_amount: quote.high,
      line_items: quote.lineItems,
      assumptions: quote.assumptions,
      notes: clean(input.notes, 3000) || null,
      ai_summary: quote.summary,
      created_by: context.access.userId,
    })
    .select("id")
    .single();

  if (error || !data) return result("The quote could not be created.", "error");

  if (links.leadId) {
    await context.admin
      .from("crm_leads")
      .update({
        status: "quoted",
        estimated_value_min: quote.low,
        estimated_value_max: quote.high,
      })
      .eq("id", links.leadId)
      .eq("client_id", context.clientId);
  }

  await addTimeline(context, {
    contactId: links.contactId,
    leadId: links.leadId,
    kind: "note",
    title: "Internal ballpark prepared",
    body: quote.summary,
  });
  revalidateCrm(context.clientId);
  return result(
    `Ballpark created: $${quote.low.toLocaleString()}–$${quote.high.toLocaleString()}.`,
  );
}

export async function setCrmQuoteStatus(input: {
  clientId: string;
  quoteId: string;
  status: "internal_ballpark" | "draft" | "sent" | "accepted" | "declined";
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  if (!validUuid(input.quoteId)) return result("Quote not found.", "error");

  const { data: quote, error } = await context.admin
    .from("crm_quotes")
    .update({ status: input.status })
    .eq("id", input.quoteId)
    .eq("client_id", context.clientId)
    .select("id, contact_id, lead_id, service_type")
    .maybeSingle();

  if (error || !quote) {
    return result("The quote could not be updated.", "error");
  }

  if (quote.lead_id) {
    const leadStatus =
      input.status === "accepted"
        ? "won"
        : input.status === "declined"
          ? "lost"
          : "quoted";
    await context.admin
      .from("crm_leads")
      .update({ status: leadStatus })
      .eq("id", quote.lead_id)
      .eq("client_id", context.clientId);
  }

  await addTimeline(context, {
    contactId: quote.contact_id,
    leadId: quote.lead_id,
    kind: "note",
    title: `${quote.service_type} quote marked ${input.status.replaceAll("_", " ")}`,
  });
  revalidateCrm(context.clientId);
  return result(`Quote marked ${input.status.replaceAll("_", " ")}.`);
}

export async function updateCrmWorkspaceSettings(input: {
  clientId: string;
  name: string;
  industry?: string;
  timezone: string;
  websiteUrl?: string;
  primaryContactName?: string;
  primaryContactEmail?: string;
  primaryContactPhone?: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const name = clean(input.name, 200);
  const timezone = clean(input.timezone, 100);
  const websiteUrl = clean(input.websiteUrl, 500);
  const contactEmail = clean(input.primaryContactEmail, 240).toLowerCase();

  if (!name || !timezone) {
    return result("Company name and timezone are required.", "error");
  }
  if (websiteUrl && !/^https?:\/\//.test(websiteUrl)) {
    return result("Website must start with http:// or https://.", "error");
  }
  if (contactEmail && !contactEmail.includes("@")) {
    return result("Enter a valid primary contact email.", "error");
  }

  const { data: client, error } = await context.admin
    .from("client_businesses")
    .update({
      name,
      industry: clean(input.industry, 200) || null,
      timezone,
      website_url: websiteUrl || null,
      primary_contact_name: clean(input.primaryContactName, 200) || null,
      primary_contact_email: contactEmail || null,
      primary_contact_phone: clean(input.primaryContactPhone, 80) || null,
    })
    .eq("id", context.clientId)
    .eq("partner_id", context.partnerId)
    .select("id")
    .maybeSingle();

  if (error || !client) {
    return result("Workspace settings could not be saved.", "error");
  }

  await audit(
    context,
    "crm.workspace_settings_updated",
    "client_business",
    client.id,
    `Updated CRM workspace settings for ${name}.`,
  );
  revalidateCrm(context.clientId);
  return result("Workspace settings saved.");
}

export async function analyzeAndSaveCrmFeedback(input: {
  clientId: string;
  contactId?: string;
  source: string;
  rating?: number;
  feedbackText: string;
}): Promise<FormState> {
  const context = await actionContext(input.clientId, "crm_edit");
  if ("status" in context) return context;

  const feedbackText = clean(input.feedbackText, 6000);
  if (!feedbackText) return result("Enter the customer feedback.", "error");
  const rating =
    typeof input.rating === "number" && input.rating >= 1 && input.rating <= 5
      ? Math.round(input.rating)
      : null;
  const { analysis, ai } = await analyzeCrmFeedback({
    businessName: context.clientName,
    source: clean(input.source, 120) || "manual",
    rating,
    text: feedbackText,
  });

  const { data: feedback, error } = await context.admin
    .from("crm_feedback")
    .insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: validUuid(input.contactId) ? input.contactId : null,
      source: clean(input.source, 120) || "manual",
      rating,
      feedback_text: feedbackText,
      sentiment: analysis.sentiment,
      risk_level: analysis.risk_level,
      summary: analysis.summary,
      suggested_internal_action: analysis.suggested_internal_action,
      suggested_customer_response: analysis.suggested_customer_response,
      tags: analysis.tags,
      ai_status: ai.status,
      raw_output: analysis,
    })
    .select("id")
    .single();

  if (error || !feedback) {
    return result("The feedback analysis could not be saved.", "error");
  }

  if (analysis.risk_level === "high" || analysis.risk_level === "urgent") {
    await context.admin.from("crm_tasks").insert({
      partner_id: context.partnerId,
      client_id: context.clientId,
      contact_id: validUuid(input.contactId) ? input.contactId : null,
      title: `${analysis.risk_level === "urgent" ? "Urgent" : "Manager"} feedback follow-up`,
      description: analysis.suggested_internal_action,
      priority: analysis.risk_level === "urgent" ? "urgent" : "high",
      status: "open",
      due_at: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      created_by: context.access.userId,
    });
  }

  await audit(
    context,
    "crm.feedback_analyzed",
    "crm_feedback",
    feedback.id,
    `Analyzed ${analysis.sentiment} feedback at ${analysis.risk_level} risk.`,
  );
  revalidateCrm(context.clientId);
  return result(
    `Feedback analyzed as ${analysis.sentiment} / ${analysis.risk_level} risk (${ai.status === "ai" ? "AI" : "built-in automation"}).`,
  );
}
