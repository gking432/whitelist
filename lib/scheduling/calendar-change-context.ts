import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEffectiveAuthority } from "../agents/authority.ts";
import { calendarMutationProposalEligibilityBlock, readCalendarMutationPayload, sameMutationSlot, verifiedRescheduleLifecycleState, type CalendarMutationPayload, type CalendarMutationProposalState } from "./calendar-mutation-rules.ts";
import type { CustomerJourney } from "../business/customer-journey-contract.ts";
import { formatSlotLabel } from "./slots.ts";

export type CalendarChangeScope = { partnerId: string; clientId: string };
type Row = Record<string, unknown>;
export const changeObject = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
const nullable = (value: unknown) => text(value) || null;
const list = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : [];
export function calendarChangeRevision(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object"
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, data]) => [key, stable(data)])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
export type CurrentBookingReview = {
  booking: Row; receipt: Row; appointment: Row; contact: Row; lead: Row; originWork: Row;
  source: Row | null; conversation: Row | null; activity: Row | null; authorityRevision: number;
  revision: string; review: NonNullable<CustomerJourney["calendarReview"]>;
  qualificationReview: NonNullable<CustomerJourney["qualificationReview"]>;
  payload: CalendarMutationPayload | null; eligibility: CalendarMutationProposalState;
};

/** All relationship choices come from the original scoped booking, never an address match. */
export async function loadCurrentBookingReview(admin: SupabaseClient, scope: CalendarChangeScope, bookingId: string, now = new Date().toISOString()): Promise<CurrentBookingReview> {
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns).eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  const [bookingResult, receiptResult, nativeResult, clientResult, settingsResult] = await Promise.all([
    scoped("approval_items", "id,type,status,proposed_payload,created_at").eq("id", bookingId).eq("type", "appointment_booking").maybeSingle(),
    scoped("action_jobs", "id,status,external_ref,receipt_recorded_at").eq("approval_id", bookingId).eq("kind", "calendar.book").maybeSingle(),
    scoped("crm_appointments", "id,lead_id,contact_id,approval_id,status,start_at,end_at,updated_at,calendar_state_job_id,external_ref").eq("approval_id", bookingId).maybeSingle(),
    admin.from("client_businesses").select("timezone,status,crm_operating_mode,default_runtime_mode").eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle(),
    scoped("agent_team_settings", "authority_revision").maybeSingle(),
  ]);
  if ([bookingResult, receiptResult, nativeResult, clientResult, settingsResult].some((result) => result.error) || !bookingResult.data || !receiptResult.data || !nativeResult.data)
    throw new Error("The original booking and its saved result could not be checked.");
  const booking: Row = bookingResult.data, receipt: Row = receiptResult.data, appointment: Row = nativeResult.data;
  const original = changeObject(booking.proposed_payload);
  let effectiveReceiptAt = nullable(receipt.receipt_recorded_at), invalidState = !appointment.calendar_state_job_id && !sameMutationSlot({ start_iso: text(appointment.start_at), end_iso: text(appointment.end_at) }, { start_iso: text(changeObject(original.slot).start_iso), end_iso: text(changeObject(original.slot).end_iso) });
  if (appointment.calendar_state_job_id && appointment.status === "booked") {
    const stateJob = await scoped("action_jobs", "id,partner_id,client_id,approval_id,kind,status,external_ref,provider_receipt").eq("id", text(appointment.calendar_state_job_id)).maybeSingle();
    const stateApproval = stateJob.data?.approval_id ? await scoped("approval_items", "id,partner_id,client_id,type,status,proposed_payload").eq("id", stateJob.data.approval_id).maybeSingle() : { data: null, error: null };
    if (stateJob.error || stateApproval.error) throw new Error("The current calendar change receipt could not be verified.");
    const proof = verifiedRescheduleLifecycleState({ scope, origin: { bookingApprovalId: bookingId, bookingActionJobId: text(receipt.id), provider: text(original.provider), calendarConnectionId: nullable(original.calendar_connection_id), externalRef: text(receipt.external_ref) },
      native: { id: text(appointment.id), contactId: nullable(appointment.contact_id), slot: { start_iso: text(appointment.start_at), end_iso: text(appointment.end_at) }, stateJobId: text(appointment.calendar_state_job_id) }, job: stateJob.data, approval: stateApproval.data, now });
    if (!proof || !effectiveReceiptAt || Date.parse(proof.receiptAt) < Date.parse(effectiveReceiptAt)) invalidState = true;
    else effectiveReceiptAt = proof.receiptAt;
  }
  const [contactResult, originWorkResult, conversationResult] = await Promise.all([
    scoped("crm_contacts", "id,first_name,last_name,email,phone,tags,updated_at").eq("id", text(appointment.contact_id)).maybeSingle(),
    scoped("agent_work_items", "id,source_lead_id,conversation_id,input,created_at").eq("approval_id", bookingId).maybeSingle(),
    original.conversation_id ? scoped("business_conversations", "id,lead_id,contact_id,identity_status,mode,opted_out,revision").eq("id", text(original.conversation_id)).maybeSingle() : { data: null, error: null },
  ]);
  if (contactResult.error || originWorkResult.error || conversationResult.error || !contactResult.data) throw new Error("The exact booked customer is unavailable.");
  const contact: Row = contactResult.data, originWork: Row = originWorkResult.data ?? {}, conversation: Row | null = conversationResult.data;
  const leadId = text(appointment.lead_id) || text(original.lead_id) || text(originWork.source_lead_id) || text(conversation?.lead_id);
  const [leadResult, communications, threads] = await Promise.all([
    leadId ? scoped("crm_leads", "id,contact_id,title,service_type,updated_at").eq("id", leadId).eq("contact_id", text(contact.id)).maybeSingle() : { data: null, error: null },
    scoped("crm_communications", "id,body,created_at").eq("contact_id", text(contact.id)).eq("direction", "inbound").eq("status", "received").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    scoped("business_conversations", "id,mode,opted_out,state").eq("contact_id", text(contact.id)).eq("identity_status", "owner_verified").limit(101),
  ]);
  if (leadResult.error || communications.error || threads.error) throw new Error("Current customer instructions could not be checked.");
  const threadIds = (threads.data ?? []).map((row) => row.id);
  const messages = threadIds.length ? await scoped("business_conversation_messages", "id,body,created_at,conversation_id").in("conversation_id", threadIds)
    .eq("direction", "inbound").eq("status", "received").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1) : { data: [], error: null };
  if (messages.error || (threads.data?.length ?? 0) > 100) throw new Error("Customer activity coverage is incomplete.");
  const activity = [...list(communications.data), ...list(messages.data)].sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)) || text(b.id).localeCompare(text(a.id)))[0] ?? null;
  const provider = text(original.provider), internal = provider === "northstar_internal";
  const authority = await readEffectiveAuthority(admin, scope, "calendar", { phase: "draft", connectionId: internal ? null : nullable(original.calendar_connection_id), internalCalendar: internal });
  let account: Row | null = null, source: Row | null = null, sourceConflict = false;
  if (!internal && original.calendar_connection_id) {
    const connection = await scoped("integration_connections", "id,provider_id,external_account_id,status,runtime_mode,config,provider:integration_providers!inner(provider_key)").eq("id", text(original.calendar_connection_id)).maybeSingle();
    if (connection.error) throw new Error("The original calendar account could not be checked.");
    account = connection.data;
    if (account) {
      const peers = account.external_account_id ? await scoped("integration_connections", "id").eq("provider_id", account.provider_id).eq("external_account_id", account.external_account_id).limit(101) : { data: [{ id: account.id }], error: null };
      if (peers.error || (peers.data?.length ?? 0) > 100) throw new Error("Calendar account coverage is incomplete.");
      const ids = [...new Set([text(account.id), ...(peers.data ?? []).map((row) => row.id)])];
      const [records, streams] = await Promise.all([
        scoped("integration_canonical_records", "id,connection_id,external_updated_at,source_event_at,snapshot_observed_at,canonical_data,source_payload,native_object_id").in("connection_id", ids).eq("object_type", "appointment").eq("external_object_id", text(receipt.external_ref)).order("snapshot_observed_at", { ascending: false }).limit(101),
        scoped("integration_sync_states", "status,last_error,cursor_value").in("connection_id", ids).eq("stream_key", "appointment").limit(101),
      ]);
      if (records.error || streams.error || (records.data?.length ?? 0) > 100) throw new Error("The exact source calendar could not be reconciled.");
      source = records.data?.[0] ?? null;
      const chosenEtag = text(changeObject(source?.source_payload).etag ?? changeObject(source?.source_payload)["@odata.etag"]);
      sourceConflict = (streams.data ?? []).some((row) => row.last_error || ["paused", "failing"].includes(row.status) || row.cursor_value?.has_more || row.cursor_value?.pageToken || row.cursor_value?.nextLink) ||
        (records.data ?? []).some((row) => {
          const data = changeObject(row.canonical_data), raw = changeObject(row.source_payload);
          return (row.native_object_id && row.native_object_id !== appointment.id) || !sameMutationSlot({ start_iso: text(data.start_at), end_iso: text(data.end_at) }, { start_iso: text(appointment.start_at), end_iso: text(appointment.end_at) }) ||
            text(raw.etag ?? raw["@odata.etag"]) !== chosenEtag || data.deleted === true || ["cancelled", "canceled"].includes(text(data.status));
        });
    }
  }
  const sourceData = changeObject(source?.canonical_data), sourceRaw = changeObject(source?.source_payload);
  const eligibility: CalendarMutationProposalState = {
    appointment: { id: text(appointment.id), updatedAt: text(appointment.updated_at), contactId: text(contact.id), status: text(appointment.status), slot: { start_iso: text(appointment.start_at), end_iso: text(appointment.end_at) }, externalRef: text(appointment.external_ref) },
    contact: { id: text(contact.id), updatedAt: text(contact.updated_at), tags: contact.tags },
    receipt: { id: text(receipt.id), status: text(receipt.status), externalRef: text(receipt.external_ref), recordedAt: effectiveReceiptAt },
    connection: account ? { id: text(account.id), accountId: nullable(account.external_account_id), provider: text(changeObject(account.provider).provider_key), status: text(account.status), runtimeMode: text(account.runtime_mode), readOnly: changeObject(account.config).workspace_view_only === true } : null,
    source: source ? { id: text(source.id), updatedAt: text(source.external_updated_at ?? sourceRaw.updated), etag: nullable(sourceRaw.etag ?? sourceRaw["@odata.etag"]), externalRef: text(receipt.external_ref), status: text(sourceData.status), deleted: sourceData.deleted === true, observedAt: text(source.snapshot_observed_at), slot: { start_iso: text(sourceData.start_at), end_iso: text(sourceData.end_at) } } : null,
    authority, latestInbound: activity ? { id: text(activity.id), at: text(activity.created_at) } : null,
    humanTakeover: (threads.data ?? []).some((row) => row.opted_out || (row.mode === "human" && row.state !== "closed")),
  };
  const candidate = { calendar_mutation_version: 1, mutation: "cancel", booking_approval_id: bookingId, booking_action_job_id: receipt.id,
    appointment_id: appointment.id, appointment_updated_at: appointment.updated_at, contact_id: contact.id, contact_updated_at: contact.updated_at,
    provider, calendar_connection_id: internal ? null : nullable(account?.id), calendar_account_id: internal ? null : nullable(account?.external_account_id),
    calendar_id: internal ? null : text(changeObject(account?.config).calendar_id) || "primary", external_ref: receipt.external_ref,
    source_record_id: internal ? null : source?.id ?? null, source_updated_at: internal ? appointment.updated_at : source?.external_updated_at ?? sourceRaw.updated,
    source_etag: internal ? null : nullable(sourceRaw.etag ?? sourceRaw["@odata.etag"]), old_slot: { start_iso: appointment.start_at, end_iso: appointment.end_at },
    authority_revision: authority.revision, customer_activity_id: activity?.id ?? null, customer_activity_at: activity?.created_at ?? null,
    conversation_id: conversation?.id ?? null, conversation_revision: conversation?.revision ?? null };
  const payload = readCalendarMutationPayload(candidate);
  let reason = payload ? calendarMutationProposalEligibilityBlock(payload, eligibility, now) : "The exact source event version or account binding is unavailable. Refresh or reconnect the original calendar.";
  if (sourceConflict) reason = "Calendar records conflict or are incomplete. Reconcile the exact source before changing this appointment.";
  if (invalidState) reason = "The current appointment time has no matching verified calendar-change receipt. Reconcile it before another change.";
  if (!internal && (sourceRaw.recurringEventId || Array.isArray(sourceRaw.recurrence) || (Array.isArray(sourceRaw.attendees) && sourceRaw.attendees.length) || changeObject(sourceRaw.organizer).self !== true))
    reason = "This shared or recurring appointment requires a change in its source calendar.";
  const originInput = changeObject(originWork.input);
  let inquiry: Row | null = null;
  if (originInput.intake_record_id) {
    const inquiryResult = await scoped("integration_canonical_records", "id,connection_id,external_object_id,updated_at,canonical_data,native_object_id").eq("id", text(originInput.intake_record_id)).eq("object_type", "lead").maybeSingle();
    if (inquiryResult.error) throw new Error("The original inquiry source could not be checked.");
    inquiry = inquiryResult.data;
  }
  const lead: Row = leadResult.data ?? {};
  const versionFacts = { bookingId, appointment: appointment.updated_at, stateJob: appointment.calendar_state_job_id, contact: contact.updated_at, lead: lead.updated_at,
    source: source?.id, sourceModified: source?.external_updated_at, sourceEtag: sourceRaw.etag ?? sourceRaw["@odata.etag"], inquiry: inquiry?.id, inquiryUpdated: inquiry?.updated_at,
    conversationId: conversation?.id, conversationRevision: conversation?.revision, activityId: activity?.id, activityAt: activity?.created_at, authority: authority.revision };
  const revision = calendarChangeRevision(versionFacts);
  let timezone = text(clientResult.data?.timezone) || "America/Chicago";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { timezone = "UTC"; }
  const label = Number.isFinite(Date.parse(text(appointment.start_at))) ? formatSlotLabel(text(appointment.start_at), timezone) : "Recorded time unavailable";
  return { booking, receipt, appointment, contact, lead, originWork, source: inquiry, conversation, activity, authorityRevision: authority.revision, revision, payload, eligibility,
    review: { bookingApprovalId: bookingId, revision, provider, timezone, current: { start_iso: text(appointment.start_at), end_iso: text(appointment.end_at), label }, status: text(appointment.status), writeAllowed: reason === null,
      writeDetail: reason ?? "A source-bound proposal can be prepared. Owner approval and final source/availability checks are required before any change.", sources: [{ kind: "approval", id: bookingId }, { kind: "appointment", id: text(appointment.id), revision: text(appointment.updated_at) }, ...(source ? [{ kind: "source", id: text(source.id), revision: text(source.external_updated_at) }] : [])] },
    qualificationReview: { detail: conversation && (conversation.mode !== "agent" || conversation.opted_out)
      ? "Review the original customer thread and explicitly resume it through its existing controls before requesting new scheduling. This review does not resume human takeover or remove an opt-out."
      : "Review the current customer instructions and chosen identity before requesting another appointment. Existing receipts stay unchanged.",
      instructions: [text(changeObject(inquiry?.canonical_data).description) ? `Current form instructions:\n${text(changeObject(inquiry?.canonical_data).description).slice(0, 2800)}` : "", text(activity?.body) ? `Latest received customer message:\n${text(activity?.body).slice(0, 2800)}` : ""].filter(Boolean).join("\n\n") || "No current written instructions were recorded. Confirm the request with the customer before continuing.",
      sources: [...(activity ? [{ kind: "customer_activity", id: text(activity.id), revision: text(activity.created_at) }] : []), ...(inquiry ? [{ kind: "source", id: text(inquiry.id), revision: text(inquiry.updated_at) }] : []),
        ...(conversation ? [{ kind: "conversation", id: text(conversation.id), revision: String(conversation.revision), href: `/client/messages?id=${conversation.id}` }] : [])] } };
}
