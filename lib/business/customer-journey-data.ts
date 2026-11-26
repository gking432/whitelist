import { readCalendarReconciliationReview } from "../scheduling/calendar-reconciliation.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerJourney, CustomerJourneyAction, CustomerJourneySnapshot, CustomerJourneyStage, CustomerJourneyState } from "./customer-journey-contract.ts";
import { sameIntakeRevision } from "../connections/intake-adoption.ts";
import { customerJourneyTiming } from "./customer-journey-timing.ts";
import { calendarChangeEvidence } from "./calendar-change-evidence.ts";
import { loadCurrentBookingReview } from "../scheduling/calendar-change-context.ts";

export type JourneyScope = { partnerId: string; clientId: string };
export type JourneyRow = Record<string, unknown>;
export type JourneyEvidence = {
  leads: JourneyRow[]; contacts: JourneyRow[]; sources: JourneyRow[]; tasks: JourneyRow[];
  conversations: JourneyRow[]; work: JourneyRow[]; approvals: JourneyRow[]; jobs: JourneyRow[];
  appointments: JourneyRow[]; importedAppointments: JourneyRow[]; authorityRevision: number;
  selectedConversationId?: string; selectedTaskId?: string;
  lifecycleEnabledAt?: string | null;
};
const str = (value: unknown) => typeof value === "string" ? value : "";
const obj = (value: unknown): JourneyRow => value && typeof value === "object" && !Array.isArray(value) ? value as JourneyRow : {};
const rows = (value: unknown): JourneyRow[] => Array.isArray(value) ? value as JourneyRow[] : [];
const latest = (items: JourneyRow[]) => [...items].sort((a, b) => str(b.created_at ?? b.updated_at).localeCompare(str(a.created_at ?? a.updated_at)))[0];
const approved = (status: unknown) => ["approved", "edited_and_approved"].includes(str(status));
export const intakeJourneyRevision = (source: JourneyRow, lead: JourneyRow, contact: JourneyRow, authority: number) =>
  [source.updated_at, lead.updated_at, contact.updated_at, authority].map(String).join("|");

/** Pure projection of exact persisted relationships. Approve/work completion is never a provider receipt. */
export function buildCustomerJourneys(evidence: JourneyEvidence, canWrite: boolean, now = new Date().toISOString()): CustomerJourney[] {
  const stage = (key: CustomerJourneyStage["key"], status: CustomerJourneyState, summary: string, row: JourneyRow, kind: string, href?: string): CustomerJourneyStage => ({
    key, status, summary, updatedAt: str(row.updated_at ?? row.created_at) || null,
    sources: str(row.id) ? [{ kind, id: str(row.id), revision: str(row.updated_at) || undefined, href }] : [], href,
  });
  return evidence.leads.map((lead): CustomerJourney => {
    const id = str(lead.id), contact = evidence.contacts.find((row) => row.id === lead.contact_id) ?? {};
    const sourceRows = evidence.sources.filter((row) => row.native_object_id === id && row.object_type === "lead");
    const source = sourceRows.length === 1 ? sourceRows[0] : undefined;
    const threads = evidence.conversations.filter((row) => row.lead_id === id && row.contact_id === lead.contact_id);
    const conversation = evidence.selectedConversationId ? threads.find((row) => row.id === evidence.selectedConversationId) : latest(threads);
    const leadWork = evidence.work.filter((row) => row.source_lead_id === id);
    const work = latest(leadWork.filter((row) => row.kind === "booking_request")) ?? latest(leadWork);
    const inquiryStale = obj(work?.input).origin === "owner_intake" && (!source ||
      !sameIntakeRevision(str(obj(work?.input).source_updated_at), str(source.updated_at)) ||
      !sameIntakeRevision(str(obj(work?.input).lead_updated_at), str(lead.updated_at)) ||
      !sameIntakeRevision(str(obj(work?.input).contact_updated_at), str(contact.updated_at)));
    const relatedApprovals = evidence.approvals.filter((row) => obj(row.proposed_payload).lead_id === id || row.id === work?.approval_id ||
      (conversation && obj(row.proposed_payload).conversation_id === conversation.id));
    const booking = latest(relatedApprovals.filter((row) => row.type === "appointment_booking"));
    const receipt = booking && latest(evidence.jobs.filter((row) => row.approval_id === booking.id && row.kind === "calendar.book"));
    const appointment = booking && evidence.appointments.find((row) => row.approval_id === booking.id);
    const imports = appointment ? evidence.importedAppointments.filter((row) => row.native_object_id === appointment.id) : [];
    const sourceCancelled = imports.some((row) => obj(row.canonical_data).deleted === true || ["cancelled", "canceled"].includes(str(obj(row.canonical_data).status)));
    const sourceChanged = imports.some((row) => {
      const data = obj(row.canonical_data);
      return data.deleted === true || ["cancelled", "canceled"].includes(str(data.status)) ||
        (data.start_at && Date.parse(str(data.start_at)) !== Date.parse(str(appointment?.start_at))) ||
        (data.end_at && Date.parse(str(data.end_at)) !== Date.parse(str(appointment?.end_at)));
    });
    const cancellation = appointment && evidence.tasks.find((row) => row.task_type === "booking_cancellation_request" && row.booking_approval_id === booking?.id && row.status !== "cancelled");
    const rebookingTask = booking && evidence.tasks.find((row) => row.task_type === "booking_rebooking_review" && row.booking_approval_id === booking.id && row.status !== "cancelled");
    const followupsStopped = receipt?.booking_followup_phase === "stopped";
    const stages: CustomerJourneyStage[] = [];
    const warnings: string[] = [];
    if (inquiryStale) warnings.push("The inquiry or selected customer changed after scheduling was requested. Review a fresh decision; the saved booking receipt remains history.");
    if (sourceRows.length > 1) {
      warnings.push("More than one inquiry source claims this lead. Review the exact source links before scheduling.");
      stages.push({ key: "inquiry", status: "review", summary: "The inquiry source is ambiguous; automatic progression is stopped.", updatedAt: null,
        sources: sourceRows.slice(0, 5).map((row) => ({ kind: "source", id: str(row.id), revision: str(row.updated_at) })) });
    }
    if (source) {
      const data = obj(source.canonical_data), deleted = data.deleted === true || data.status === "deleted";
      stages.push(stage("inquiry", deleted ? "cancelled" : "complete", deleted ? "The form inquiry was deleted at its source; saved customer work remains." : "Form inquiry added with its exact source and chosen customer.", source, "source", "/client/messages#form-inquiries"));
      if (deleted) warnings.push("The source inquiry is deleted. Review saved work before progressing.");
    } else if (conversation) stages.push(stage("inquiry", "complete", "Inquiry retained in the original customer conversation.", conversation, "conversation", `/client/messages?id=${conversation.id}`));
    stages.push(stage("lead", ["won", "lost"].includes(str(lead.status)) ? "complete" : "requested", str(lead.next_action) || "Customer inquiry is saved in shared work.", lead, "lead", `/client/customer-work?leadId=${id}`));
    const reviewTask = evidence.tasks.find((row) => row.lead_id === id && row.task_type === "intake_review");
    if (reviewTask) stages[stages.length - 1].sources.push({ kind: "task", id: str(reviewTask.id), revision: str(reviewTask.updated_at), href: `/client/customer-work?taskId=${reviewTask.id}` });
    const selectedTask = evidence.selectedTaskId && evidence.tasks.find((row) => row.lead_id === id && row.id === evidence.selectedTaskId);
    if (selectedTask && selectedTask.id !== reviewTask?.id) stages[stages.length - 1].sources.push({ kind: "task", id: str(selectedTask.id), revision: str(selectedTask.updated_at), href: `/client/customer-work?taskId=${selectedTask.id}` });
    if (work) {
      const offer = obj(obj(work.result).offer);
      const workState: CustomerJourneyState = work.status === "completed" ? "complete" : work.status === "cancelled" ? "cancelled" : inquiryStale || work.status === "blocked" ? "review" :
        Array.isArray(offer.slots) && !obj(work.input).slot ? "needs_owner" : work.status === "waiting_approval" ? "needs_owner" : work.status === "waiting_external" ? "provider_pending" : "queued";
      stages.push(stage("assignment", workState, str(work.summary) || "The scheduling specialist is preparing the next supported step.", work, "assignment"));
      if (obj(work.input).rebooking_for || obj(work.input).rebooking_origin_approval_id) stages.push(stage("rebooking", workState, str(work.summary) || "A new-time scheduling request is saved. The prior booking remains in its recorded state.", work, "assignment"));
    }
    if (booking) {
      const expired = booking.status === "pending" && !!booking.expires_at && Date.parse(str(booking.expires_at)) <= Date.parse(now);
      stages.push(stage("approval", expired || (inquiryStale && booking.status === "pending") || ["rejected", "expired"].includes(str(booking.status)) ? "review" : booking.status === "pending" ? "needs_owner" : approved(booking.status) ? "complete" : "cancelled",
        expired ? "The booking decision expired. Choose fresh availability." : booking.status === "pending" ? "Review the requested time. It is not booked or held." : approved(booking.status) ? "Booking approved; the calendar result is checked separately." : "Booking was declined or stopped.", booking, "approval", "/client/approvals"));
      const status: CustomerJourneyState = appointment?.status === "cancelled" || sourceCancelled ? "cancelled" : sourceChanged ? "review" : receipt?.status === "succeeded" && !!receipt.external_ref ? "confirmed" :
        ["uncertain", "failed", "skipped", "dry_run"].includes(str(receipt?.status)) ? "review" : receipt?.status === "provider_pending" || receipt?.status === "processing" ? "provider_pending" : approved(booking.status) ? "queued" : "requested";
      stages.push(stage("booking", status, sourceCancelled ? "The source calendar cancelled or deleted this appointment. The original receipt is retained." : sourceChanged ? "The calendar moved or changed this appointment. Review the new time before follow-ups." : appointment?.status === "cancelled" ? "Cancellation is recorded for this appointment." :
        status === "confirmed" ? `Booking receipt saved${appointment?.start_at ? ` for ${str(appointment.start_at)}` : ""}.` : status === "provider_pending" ? "The calendar result is pending. Do not repeat the booking." : status === "review" ? str(receipt?.outcome_detail) || "The calendar outcome needs review; do not blindly retry." : "No verified booking result yet.", receipt ?? booking, "booking_receipt", "/client/calendar"));
      for (const [kind, key] of [["confirmation", "confirmation"], ["reminder", "reminder"]] as const) {
        const followup = latest(evidence.approvals.filter((row) => obj(row.proposed_payload).booking_approval_id === booking.id &&
          (obj(row.proposed_payload).booking_followup_kind === kind || (kind === "confirmation" && obj(row.proposed_payload).draft_source === "booking_confirmation_template"))));
        const job = followup && latest(evidence.jobs.filter((row) => row.approval_id === followup.id));
        if (followup) {
          const followupExpired = followup.status === "pending" && !!followup.expires_at && Date.parse(str(followup.expires_at)) <= Date.parse(now);
          const state: CustomerJourneyState = job?.status === "succeeded" ? (job.external_ref ? "confirmed" : "review") :
            ["provider_pending", "processing", "uncertain"].includes(str(job?.status)) ? (job?.status === "uncertain" ? "review" : "provider_pending") :
            sourceChanged || inquiryStale || cancellation || followupsStopped || appointment?.status === "cancelled" ? "cancelled" : followupExpired ? "review" : followup.status === "pending" ? "needs_owner" :
            ["rejected", "expired"].includes(str(followup.status)) ? "cancelled" :
              ["cancelled", "skipped"].includes(str(job?.status)) ? "cancelled" : ["failed", "uncertain"].includes(str(job?.status)) ? "review" : approved(followup.status) ? "queued" : "draft";
          stages.push(stage(key, state, state === "confirmed" ? `${kind === "reminder" ? "Reminder" : "Confirmation"} provider result recorded.` : state === "needs_owner" ? `Review the ${kind} before delivery.` : state === "queued" ? `Approved ${kind}; waiting for its existing delivery action and current source checks.` : state === "cancelled" ? `The ${kind} is stopped or no longer eligible.` : str(job?.outcome_detail) || `The ${kind} needs review.`, followup, "approval", "/client/approvals"));
        } else if (kind === "confirmation" && status === "confirmed") stages.push(stage(key, "review", "Booking is saved; confirmation preparation needs review.", receipt!, "booking_receipt"));
        else if (kind === "reminder" && receipt?.booking_followup_due_at) stages.push(stage(key, "scheduled", `Reminder preparation is scheduled for ${str(receipt.booking_followup_due_at)}; it has not been sent.`, receipt, "booking_receipt"));
        else if (kind === "reminder" && receipt?.booking_followup_reason) stages.push(stage(key, "review", str(receipt.booking_followup_reason), receipt, "booking_receipt"));
      }
      if (cancellation) stages.push(stage("cancellation", appointment?.status === "cancelled" ? "confirmed" : "requested", appointment?.status === "cancelled" ? "Cancellation recorded; the original booking receipt is retained." : "Cancellation requested. External calendar changes still need a verified result; unsent follow-ups are stopped.", cancellation, "task", "/client/todo"));
      if (rebookingTask) stages.push(stage("rebooking", rebookingTask.status === "done" ? "complete" : "requested", "A rebooking review is saved in the original customer work; no new appointment has been booked.", rebookingTask, "task", "/client/todo"));
      const changes = calendarChangeEvidence(evidence.approvals.filter((row) => row.type === "appointment_change" && obj(row.proposed_payload).booking_approval_id === booking.id), evidence.jobs, str(appointment?.updated_at) || null, now);
      stages.push(...changes.stages); warnings.push(...changes.warnings);
    }
    if (Array.isArray(contact.tags) && contact.tags.some((tag) => /^(do_not_contact|opt_out|opted_out|unsubscribed|stop)$/i.test(String(tag).replace(/[\s-]+/g, "_")))) warnings.push("This customer has a contact suppression. Outgoing follow-ups must remain stopped.");
    const actions: CustomerJourneyAction[] = [];
    let revision = str(lead.updated_at);
    if (source) revision = intakeJourneyRevision(source, lead, contact, evidence.authorityRevision);
    if (canWrite && source && !["won", "lost"].includes(str(lead.status)) && obj(source.canonical_data).deleted !== true) {
      const offer = obj(obj(work?.result).offer);
      if (work && !inquiryStale && !work.approval_id && Array.isArray(offer.slots) && offer.slots.length && !obj(work.input).slot && work.status !== "cancelled")
        actions.push({ kind: "command", label: "Choose a requested time", command: "select_intake_slot", targetId: str(work.id), expectedRevision: String(work.revision), requiresSlot: true });
      else if ((!booking || ((inquiryStale || ["rejected", "expired"].includes(str(booking.status))) && !["succeeded", "processing", "provider_pending", "uncertain"].includes(str(receipt?.status)))) &&
        (!work || inquiryStale || work.kind !== "booking_request" || ["blocked", "cancelled"].includes(str(work.status))))
        actions.push({ kind: "command", label: "Prepare scheduling", command: "progress_inquiry", targetId: id, expectedRevision: revision, requiresQualification: true });
    }
    if (canWrite && booking && receipt?.status === "succeeded" && appointment) {
      const version = str(appointment.updated_at);
      if (appointment.status === "booked" && !inquiryStale && !sourceChanged && !cancellation && !followupsStopped) {
        if (!stages.some((item) => item.key === "confirmation" && item.status !== "review")) actions.push({ kind: "command", label: "Review confirmation recovery", command: "recover_confirmation", targetId: str(booking.id), expectedRevision: version });
        if (evidence.lifecycleEnabledAt && receipt.receipt_recorded_at && Date.parse(str(receipt.receipt_recorded_at)) >= Date.parse(evidence.lifecycleEnabledAt)) {
          if (!stages.some((item) => item.key === "reminder" && item.status !== "review")) actions.push({ kind: "command", label: "Review reminder preparation", command: "prepare_reminder", targetId: str(booking.id), expectedRevision: version });
        } else actions.push({ kind: "link", label: "Review reminder setup for future bookings", href: "/client/integrations" });
        actions.push({ kind: "command", label: "Request cancellation", command: "request_cancellation", targetId: str(booking.id), expectedRevision: version });
      }
      if ((["cancelled", "completed"].includes(str(appointment.status)) || sourceCancelled) && !rebookingTask && !leadWork.some((row) => (obj(row.input).rebooking_for === booking.id || obj(row.input).rebooking_origin_approval_id === booking.id) && !["cancelled", "blocked"].includes(str(row.status))))
        actions.push({ kind: "command", label: "Prepare rebooking", command: "prepare_rebooking", targetId: str(booking.id), expectedRevision: version });
    }
    const ownerStage = stages.find((item) => item.status === "needs_owner" && item.href);
    const setupNeeded = obj(work?.result).phase === "needs_setup";
    const nextAction = ownerStage?.href ? { kind: "link" as const, label: "Review the owner decision", href: ownerStage.href } : setupNeeded ? { kind: "link" as const, label: "Review scheduling setup and permissions", href: "/client/activate" } : actions[0] ??
      (inquiryStale || work?.status === "blocked" ? { kind: "link" as const, label: "Review shared work", href: "/client/todo" } : null);
    return { id, leadId: id, title: str(lead.title) || "Customer inquiry", customer: { id: str(contact.id), name: [str(contact.first_name), str(contact.last_name)].filter(Boolean).join(" ") || "Customer identity unavailable",
      identity: Array.isArray(contact.tags) && contact.tags.includes("source_identity_unverified") ? "unverified" : "unknown", email: str(contact.email) || null, phone: str(contact.phone) || null },
      conversationId: str(conversation?.id) || null, revision, updatedAt: str(lead.updated_at), warnings, stages, nextAction, actions,
      observations: customerJourneyTiming({ now, inquiry: source ? { id: str(source.id), receivedAt: str(obj(source.canonical_data).received_at) || null } : undefined,
        bookingReceipt: receipt?.status === "succeeded" && receipt.external_ref ? { id: str(receipt.id), recordedAt: str(receipt.receipt_recorded_at) || null } : undefined,
        pendingDecision: booking?.status === "pending" ? { id: str(booking.id), createdAt: str(booking.created_at) || null, expiresAt: str(booking.expires_at) || null } : undefined }) };
  });
}

export async function readCustomerJourneys(admin: SupabaseClient, scope: JourneyScope, canWrite: boolean, filters: { leadId?: string; conversationId?: string; taskId?: string } = {}): Promise<CustomerJourneySnapshot> {
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  let leadId = filters.leadId;
  for (const [table, id] of [["business_conversations", filters.conversationId], ["crm_tasks", filters.taskId]]) if (id) {
    const result = await scoped(table!, "lead_id").eq("id", id).maybeSingle();
    if (result.error) throw new Error("The selected customer work could not be loaded.");
    if (!result.data?.lead_id || (leadId && leadId !== result.data.lead_id)) return { version: 1, generatedAt: new Date().toISOString(), canWrite, limited: false, errors: [], journeys: [] };
    leadId = result.data.lead_id;
  }
  let query = scoped("crm_leads", "id,contact_id,title,status,next_action,updated_at,created_at");
  if (leadId) query = query.eq("id", leadId);
  const leadResult = await query.order("updated_at", { ascending: false }).limit(21);
  if (leadResult.error) throw new Error("Customer leads could not be loaded.");
  const leads = rows(leadResult.data).slice(0, 20), ids = leads.map((row) => str(row.id));
  const empty = { data: [], error: null };
  const [contacts, sources, tasks, conversations, work, settings, client] = await Promise.all([
    ids.length ? scoped("crm_contacts", "id,first_name,last_name,email,phone,tags,updated_at").in("id", [...new Set(leads.map((row) => str(row.contact_id)))]) : empty,
    ids.length ? scoped("integration_canonical_records", "id,connection_id,object_type,external_object_id,native_object_id,canonical_data,updated_at").eq("object_type", "lead").in("native_object_id", ids).limit(201) : empty,
    ids.length ? scoped("crm_tasks", "id,lead_id,booking_approval_id,status,title,task_type,updated_at,created_at").in("lead_id", ids).order("created_at", { ascending: false }).limit(201) : empty,
    ids.length ? scoped("business_conversations", "id,lead_id,contact_id,mode,opted_out,revision,updated_at,created_at").in("lead_id", ids).limit(201) : empty,
    ids.length ? scoped("agent_work_items", "id,source_lead_id,approval_id,kind,status,input,result,summary,revision,updated_at,created_at").in("source_lead_id", ids).order("created_at", { ascending: false }).limit(201) : empty,
    scoped("agent_team_settings", "authority_revision").maybeSingle(),
    admin.from("client_businesses").select("native_lifecycle_enabled_at").eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle(),
  ]);
  const approvalIds = rows(work.data).map((row) => str(row.approval_id)).filter(Boolean), conversationIds = rows(conversations.data).map((row) => str(row.id));
  const terms = [ids.length ? `proposed_payload->>lead_id.in.(${ids.join(",")})` : "", approvalIds.length ? `id.in.(${approvalIds.join(",")})` : "", conversationIds.length ? `proposed_payload->>conversation_id.in.(${conversationIds.join(",")})` : ""].filter(Boolean);
  const columns = "id,type,status,proposed_payload,expires_at,updated_at,created_at";
  const bookings = terms.length ? await scoped("approval_items", columns).eq("type", "appointment_booking").or(terms.join(",")).order("created_at", { ascending: false }).limit(201) : empty;
  const bookingIds = rows(bookings.data).map((row) => str(row.id));
  const [followups, appointments, lifecycleTasks] = await Promise.all([
    bookingIds.length ? scoped("approval_items", columns).in("proposed_payload->>booking_approval_id", bookingIds).order("created_at", { ascending: false }).limit(201) : empty,
    bookingIds.length ? scoped("crm_appointments", "id,approval_id,lead_id,contact_id,status,start_at,end_at,updated_at").in("approval_id", bookingIds).limit(201) : empty,
    bookingIds.length ? scoped("crm_tasks", "id,lead_id,booking_approval_id,status,title,task_type,updated_at,created_at").in("booking_approval_id", bookingIds).order("created_at", { ascending: false }).limit(201) : empty,
  ]);
  const allApprovalIds = [...bookingIds, ...rows(followups.data).map((row) => str(row.id))], appointmentIds = rows(appointments.data).map((row) => str(row.id));
  const [jobs, importedAppointments] = await Promise.all([
    allApprovalIds.length ? scoped("action_jobs", "id,approval_id,kind,status,external_ref,receipt_recorded_at,provider_receipt,calendar_reconciliation,calendar_reconciled_at,last_attempt_at,claimed_at,calendar_reconcile_due_at,calendar_reconcile_reason,outcome_detail,booking_followup_due_at,booking_followup_phase,booking_followup_reason,updated_at,created_at").in("approval_id", allApprovalIds).limit(401) : empty,
    appointmentIds.length ? scoped("integration_canonical_records", "id,native_object_id,canonical_data,updated_at").eq("object_type", "appointment").in("native_object_id", appointmentIds).limit(201) : empty,
  ]);
  const results = [contacts, sources, tasks, conversations, work, settings, client, bookings, followups, appointments, lifecycleTasks, jobs, importedAppointments];
  if (results.some((result) => result.error)) throw new Error("The customer journey could not be fully checked. Refresh before making a decision.");
  const generatedAt = new Date().toISOString();
  const journeys = buildCustomerJourneys({ leads, contacts: rows(contacts.data), sources: rows(sources.data), tasks: [...new Map([...rows(tasks.data), ...rows(lifecycleTasks.data)].map((row) => [row.id, row])).values()], conversations: rows(conversations.data), work: rows(work.data), approvals: [...rows(bookings.data), ...rows(followups.data)], jobs: rows(jobs.data), appointments: rows(appointments.data), importedAppointments: rows(importedAppointments.data), authorityRevision: Number(settings.data?.authority_revision ?? 0), lifecycleEnabledAt: client.data?.native_lifecycle_enabled_at ?? null, selectedConversationId: filters.conversationId, selectedTaskId: filters.taskId }, canWrite, generatedAt);
  await Promise.all(journeys.map(async (journey) => {
    const bookingId = journey.stages.find((item) => item.key === "approval")?.sources.find((item) => item.kind === "approval")?.id;
    if (!bookingId || !journey.stages.some((item) => item.key === "booking")) return;
    // Optional review failure affects only new controls, never recorded history.
    try {
      const review = await loadCurrentBookingReview(admin, scope, bookingId, generatedAt);
      journey.calendarReview = review.review; journey.qualificationReview = review.qualificationReview;
      const relatedChanges = rows(followups.data).filter((row) => row.type === "appointment_change" && obj(row.proposed_payload).booking_approval_id === bookingId);
      const changeState = calendarChangeEvidence(relatedChanges, rows(jobs.data), str(review.appointment.updated_at), generatedAt);
      const actions = (journey.actions ?? []).filter((action) => action.kind !== "command" || !["request_cancellation", "prepare_rebooking"].includes(action.command));
      if (canWrite && !changeState.active && review.appointment.status === "booked") {
        if (review.review.writeAllowed) actions.push(
          { kind: "command", label: "Review cancellation", command: "prepare_cancellation", targetId: bookingId, expectedRevision: review.revision },
          { kind: "command", label: "Choose a different time", command: "prepare_time_change", targetId: bookingId, expectedRevision: review.revision, requiresSlot: true });
        else actions.push({ kind: "command", label: "Save a cancellation handoff", command: "request_cancellation", targetId: bookingId, expectedRevision: review.revision });
      }
      if (canWrite && (["cancelled", "completed"].includes(str(review.appointment.status)) || journey.stages.some((stage) => stage.key === "booking" && stage.status === "cancelled")) && !changeState.active)
        actions.push({ kind: "command", label: "Review current instructions for rebooking", command: "qualify_rebooking", targetId: bookingId, expectedRevision: review.revision, requiresQualification: true });
      const unresolved = rows(jobs.data).find((job) => ["uncertain", "provider_pending"].includes(str(job.status)) && relatedChanges.some((change) => change.id === job.approval_id));
      if (unresolved && canWrite) {
        const recovery = await readCalendarReconciliationReview(admin, scope, str(unresolved.id), generatedAt);
        if (recovery) {
          journey.reconciliationReview = recovery;
          actions.unshift({ kind: "command", label: "Check saved calendar result", command: "reconcile_calendar_change", targetId: recovery.jobId, expectedRevision: recovery.revision });
        }
      }
      journey.actions = actions;
      const ownerDecision = journey.stages.find((item) => item.status === "needs_owner" && item.href);
      journey.nextAction = ownerDecision?.href ? { kind: "link", label: "Review the owner decision", href: ownerDecision.href } : actions[0] ?? null;
    } catch {
      journey.warnings.push("Current calendar change permissions and instructions could not be checked. Saved history is retained; refresh before preparing another action.");
      journey.actions = (journey.actions ?? []).filter((action) => action.kind !== "command" || !["request_cancellation", "prepare_rebooking"].includes(action.command));
      if (journey.nextAction?.kind === "command" && ["request_cancellation", "prepare_rebooking"].includes(journey.nextAction.command))
        journey.nextAction = { kind: "link", label: "Review current saved work", href: "/client/todo" };
    }
  }));
  return { version: 1, generatedAt, canWrite, limited: rows(leadResult.data).length > 20 || results.some((result) => Array.isArray(result.data) && result.data.length > 200), errors: [], journeys };
}
