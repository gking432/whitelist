import type { SupabaseClient } from "@supabase/supabase-js";

import { extractContactFields } from "@/lib/crm/contact-fields";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { RunStep } from "@/lib/workflows/handlers";

// Built-in CRM writer (docs/12 "Built-In CRM Mode"). Fills Northstar's own
// contacts/leads/timeline/tasks/appointments for clients whose
// crm_operating_mode uses the built-in CRM (primary_crm), mirrors into it
// (mirror), or assists alongside an external CRM (assist). External-only
// and webhook-only clients are untouched. All writes here run through the
// service role from trusted server paths and attribute AI work as
// actor_type 'ai_assistant'. Never throws — a CRM bookkeeping failure must
// not break a run or a delivery.

const INTERNAL_CRM_MODES = new Set(["primary_crm", "mirror", "assist"]);

async function clientUsesInternalCrm(
  admin: SupabaseClient,
  clientId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("client_businesses")
    .select("crm_operating_mode")
    .eq("id", clientId)
    .maybeSingle();

  return INTERNAL_CRM_MODES.has(data?.crm_operating_mode ?? "");
}

type ContactMatchInput = {
  partnerId: string;
  clientId: string;
  email: string | null;
  phone: string | null;
};

async function findContactId(
  admin: SupabaseClient,
  input: ContactMatchInput,
): Promise<string | null> {
  if (input.email) {
    const { data } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", input.clientId)
      .ilike("email", input.email)
      .limit(1)
      .maybeSingle();

    if (data) {
      return data.id;
    }
  }

  if (input.phone) {
    const { data } = await admin
      .from("crm_contacts")
      .select("id")
      .eq("client_id", input.clientId)
      .eq("phone", input.phone)
      .limit(1)
      .maybeSingle();

    if (data) {
      return data.id;
    }
  }

  return null;
}

type LeadRecordInput = {
  partnerId: string;
  clientId: string;
  runId: string;
  templateKey: string;
  eventType: string;
  eventData: Record<string, unknown>;
  runSummary: string;
  analysis: Record<string, unknown> | null;
};

export type InternalCrmResult = {
  step: RunStep;
  internal_crm: Record<string, unknown>;
};

// Records a new lead in the built-in CRM: additive contact upsert, a lead
// row, an AI Assistant timeline note, and the AI-suggested follow-up task.
export async function recordLeadInInternalCrm(
  admin: SupabaseClient,
  input: LeadRecordInput,
): Promise<InternalCrmResult | null> {
  // Only the lead-analysis run writes (one lead per interaction, not one
  // per matched workflow).
  if (input.templateKey !== "new_lead_intake") {
    return null;
  }

  try {
    if (!(await clientUsesInternalCrm(admin, input.clientId))) {
      return null;
    }

    const fields = extractContactFields(input.eventData);

    if (!fields.email && !fields.phone) {
      return {
        step: {
          name: "Built-in CRM skipped",
          detail:
            "No email or phone in the event, so no built-in CRM contact was created.",
        },
        internal_crm: { status: "skipped", reason: "no_contact_identifier" },
      };
    }

    let contactId = await findContactId(admin, {
      partnerId: input.partnerId,
      clientId: input.clientId,
      email: fields.email,
      phone: fields.phone,
    });
    let contactAction: "created" | "updated" = "updated";

    if (!contactId) {
      const { data: created, error } = await admin
        .from("crm_contacts")
        .insert({
          partner_id: input.partnerId,
          client_id: input.clientId,
          first_name: fields.firstname,
          last_name: fields.lastname,
          email: fields.email,
          phone: fields.phone,
          address: fields.address,
          source: input.eventType,
        })
        .select("id")
        .single();

      if (error || !created) {
        throw new Error("The built-in CRM contact could not be created.");
      }

      contactId = created.id;
      contactAction = "created";
    } else {
      // Additive update: only fill fields that are currently empty.
      const { data: existing } = await admin
        .from("crm_contacts")
        .select("first_name, last_name, email, phone, address")
        .eq("id", contactId)
        .maybeSingle();

      if (existing) {
        const patch: Record<string, string> = {};

        if (!existing.first_name && fields.firstname)
          patch.first_name = fields.firstname;
        if (!existing.last_name && fields.lastname)
          patch.last_name = fields.lastname;
        if (!existing.email && fields.email) patch.email = fields.email;
        if (!existing.phone && fields.phone) patch.phone = fields.phone;
        if (!existing.address && fields.address)
          patch.address = fields.address;

        if (Object.keys(patch).length > 0) {
          await admin.from("crm_contacts").update(patch).eq("id", contactId);
        }
      }
    }

    const urgency =
      typeof input.analysis?.urgency === "string"
        ? input.analysis.urgency
        : null;
    const quality =
      typeof input.analysis?.lead_quality === "string"
        ? input.analysis.lead_quality
        : null;

    const { data: lead } = await admin
      .from("crm_leads")
      .insert({
        partner_id: input.partnerId,
        client_id: input.clientId,
        contact_id: contactId,
        status: "new",
        source_event_type: input.eventType,
        urgency,
        quality,
        summary: input.runSummary,
      })
      .select("id")
      .single();

    await admin.from("crm_timeline_entries").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      contact_id: contactId,
      lead_id: lead?.id ?? null,
      kind: "note",
      actor_type: "ai_assistant",
      title: "AI Assistant analyzed the lead",
      body: input.runSummary,
      ref_run_id: input.runId,
    });

    // The AI already suggests a follow-up task on every lead — make it a
    // real task row in the built-in CRM.
    const suggestedTask = input.analysis?.suggested_task as
      | {
          title?: string;
          description?: string;
          priority?: string;
          due_in_minutes?: number;
        }
      | undefined;

    let taskCreated = false;

    if (suggestedTask?.title) {
      const dueAt =
        typeof suggestedTask.due_in_minutes === "number"
          ? new Date(
              Date.now() + suggestedTask.due_in_minutes * 60 * 1000,
            ).toISOString()
          : null;

      await admin.from("crm_tasks").insert({
        partner_id: input.partnerId,
        client_id: input.clientId,
        contact_id: contactId,
        title: suggestedTask.title,
        description: suggestedTask.description ?? null,
        priority: ["urgent", "high", "medium", "low"].includes(
          suggestedTask.priority ?? "",
        )
          ? suggestedTask.priority
          : "medium",
        status: "open",
        due_at: dueAt,
      });
      taskCreated = true;
    }

    return {
      step: {
        name: "Built-in CRM updated",
        detail: `Contact ${contactAction}, lead recorded${taskCreated ? ", and the AI-suggested follow-up task created" : ""} in Northstar's built-in CRM.`,
      },
      internal_crm: {
        status: "recorded",
        contact_id: contactId,
        contact_action: contactAction,
        lead_id: lead?.id ?? null,
        task_created: taskCreated,
      },
    };
  } catch (error) {
    return {
      step: {
        name: "Built-in CRM failed",
        detail:
          error instanceof Error
            ? `${error.message} The run itself completed.`
            : "The built-in CRM update failed. The run itself completed.",
      },
      internal_crm: { status: "failed" },
    };
  }
}

// Timeline contribution for a delivered (or dry-run) customer message.
export async function recordTimelineMessage(input: {
  partnerId: string;
  clientId: string;
  approvalId: string;
  workflowRunId: string | null;
  channel: string;
  to: string | null;
  body: string;
  outcomeStatus: string;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  try {
    if (!(await clientUsesInternalCrm(admin, input.clientId))) {
      return;
    }

    const contactId = await findContactId(admin, {
      partnerId: input.partnerId,
      clientId: input.clientId,
      email: input.channel === "email" ? input.to : null,
      phone: input.channel === "sms" ? input.to : null,
    });

    await admin.from("crm_timeline_entries").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      contact_id: contactId,
      kind: "message",
      actor_type: "ai_assistant",
      title:
        input.outcomeStatus === "succeeded"
          ? `AI Assistant sent an approved ${input.channel.toUpperCase()}${input.to ? ` to ${input.to}` : ""}`
          : `AI Assistant recorded an approved ${input.channel.toUpperCase()} (${input.outcomeStatus.replaceAll("_", " ")})`,
      body: input.body,
      ref_run_id: input.workflowRunId,
      ref_approval_id: input.approvalId,
    });
  } catch {
    // Timeline bookkeeping must never break delivery reporting.
  }
}

// Appointment row + timeline entry after an approved booking.
export async function recordAppointmentBooking(input: {
  partnerId: string;
  clientId: string;
  approvalId: string;
  workflowRunId: string | null;
  payload: Record<string, unknown>;
  outcomeStatus: string;
  externalRef: string | null;
}): Promise<void> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return;
  }

  try {
    if (!(await clientUsesInternalCrm(admin, input.clientId))) {
      return;
    }

    const slot = (input.payload.slot ?? {}) as {
      start_iso?: string;
      end_iso?: string;
      label?: string;
    };
    const contact = (input.payload.contact ?? {}) as {
      name?: string;
      phone?: string;
      email?: string;
    };

    if (!slot.start_iso || !slot.end_iso) {
      return;
    }

    const contactId = await findContactId(admin, {
      partnerId: input.partnerId,
      clientId: input.clientId,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
    });

    await admin.from("crm_appointments").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      contact_id: contactId,
      title: `Appointment${contact.name ? ` — ${contact.name}` : ""}`,
      start_at: slot.start_iso,
      end_at: slot.end_iso,
      status: input.outcomeStatus === "succeeded" ? "booked" : "proposed",
      external_ref: input.externalRef,
    });

    await admin.from("crm_timeline_entries").insert({
      partner_id: input.partnerId,
      client_id: input.clientId,
      contact_id: contactId,
      kind: "appointment",
      actor_type: "ai_assistant",
      title:
        input.outcomeStatus === "succeeded"
          ? `AI Assistant booked ${slot.label ?? slot.start_iso} after approval`
          : `AI Assistant recorded an approved booking (${input.outcomeStatus.replaceAll("_", " ")}) for ${slot.label ?? slot.start_iso}`,
      body: null,
      ref_run_id: input.workflowRunId,
      ref_approval_id: input.approvalId,
    });
  } catch {
    // Bookkeeping must never break booking reporting.
  }
}
