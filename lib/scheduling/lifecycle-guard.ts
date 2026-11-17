import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";
import { authorityChannel, readEffectiveAuthority } from "../agents/authority.ts";
import {
  evaluateBookingLifecycle, readBookingLifecyclePin,
  type BookingFollowupKind, type BookingLifecycleState,
} from "./lifecycle-rules.ts";
import { verifiedRescheduleLifecycleState } from "./calendar-mutation-rules.ts";

type Scope = { partnerId: string; clientId: string };
const nullable = (value: unknown) => typeof value === "string" && value ? value : null;
const scopedRow = (row: { partner_id: string; client_id: string }) => ({ partnerId: row.partner_id, clientId: row.client_id });

/** Exact booking/receipt/customer/account identities; never email or title matching. */
export async function readBookingLifecycleState(admin: SupabaseClient, scope: Scope, origin: string, options: {
  phase: "draft" | "execute"; actionJobId?: string; expectedRevision?: number;
}): Promise<BookingLifecycleState | null> {
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns)
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  let receiptQuery = scoped("action_jobs", "id,status,external_ref,updated_at,receipt_recorded_at,booking_followup_phase")
    .eq("approval_id", origin).eq("kind", "calendar.book");
  if (options.actionJobId) receiptQuery = receiptQuery.eq("id", options.actionJobId);
  const [approval, receipt, native, client] = await Promise.all([
    scoped("approval_items", "id,status,proposed_payload").eq("id", origin).eq("type", "appointment_booking").maybeSingle(),
    receiptQuery.maybeSingle(),
    scoped("crm_appointments", "id,partner_id,client_id,approval_id,contact_id,status,start_at,end_at,updated_at,lifecycle_completed_at,calendar_state_job_id,external_ref")
      .eq("approval_id", origin).maybeSingle(),
    admin.from("client_businesses").select("status,native_lifecycle_enabled_at")
      .eq("partner_id", scope.partnerId).eq("id", scope.clientId).maybeSingle(),
  ]);
  if (approval.error || receipt.error || native.error || client.error) throw new Error("The saved booking lifecycle could not be checked.");
  if (!approval.data || !receipt.data || !native.data) return null;
  const payload = (approval.data.proposed_payload ?? {}) as Record<string, unknown>;
  const slot = (payload.slot ?? {}) as { start_iso?: string; end_iso?: string };
  const contactId = nullable(payload.contact_id) ?? nullable(native.data.contact_id);
  if (!contactId) return null;
  const [contact, activity, conversations, stopTask] = await Promise.all([
    scoped("crm_contacts", "id,partner_id,client_id,updated_at,tags,phone,email,preferred_channel").eq("id", contactId).maybeSingle(),
    scoped("crm_communications", "id,created_at").eq("contact_id", contactId).eq("direction", "inbound").eq("status", "received")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1),
    scoped("business_conversations", "id,contact_id,channel,connection_id,external_thread_id,revision,mode,opted_out,state,identity_status")
      .eq("contact_id", contactId).eq("identity_status", "owner_verified").limit(101),
    scoped("crm_tasks", "id").eq("booking_approval_id", origin).eq("task_type", "booking_cancellation_request").eq("status", "open").limit(1),
  ]);
  if (contact.error || activity.error || conversations.error || stopTask.error) throw new Error("Current customer activity or booking controls could not be checked.");
  if (!contact.data) return null;
  const verifiedThreadIds = (conversations.data ?? []).slice(0, 100).map((row) => row.id);
  const messages = verifiedThreadIds.length ? await scoped("business_conversation_messages", "id,created_at").in("conversation_id", verifiedThreadIds)
    .eq("direction", "inbound").eq("status", "received").order("created_at", { ascending: false }).order("id", { ascending: false }).limit(1) : { data: [], error: null };
  if (messages.error) throw new Error("Verified customer replies could not be checked.");
  const latestReceived = [...(activity.data ?? []), ...(messages.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0];
  let coverageComplete = (conversations.data?.length ?? 0) <= 100 && native.data.external_ref === receipt.data.external_ref;
  let stateJobId: string | null = null;
  let effectiveReceiptAt = receipt.data.receipt_recorded_at ?? "";
  let effectiveSlot = { start_iso: slot.start_iso ?? "", end_iso: slot.end_iso ?? "" };
  let effectiveAccountId: string | null = null;
  if (native.data.calendar_state_job_id) {
    const stateJob = await scoped("action_jobs", "id,partner_id,client_id,approval_id,kind,status,external_ref,provider_receipt")
      .eq("id", native.data.calendar_state_job_id).maybeSingle();
    if (stateJob.error) throw new Error("The verified appointment time change could not be checked.");
    const stateApproval = stateJob.data?.approval_id ? await scoped("approval_items", "id,partner_id,client_id,type,status,proposed_payload")
      .eq("id", stateJob.data.approval_id).maybeSingle() : { data: null, error: null };
    if (stateApproval.error) throw new Error("The approved appointment time change could not be checked.");
    const effective = verifiedRescheduleLifecycleState({ scope,
      origin: { bookingApprovalId: origin, bookingActionJobId: receipt.data.id, provider: String(payload.provider ?? ""), calendarConnectionId: nullable(payload.calendar_connection_id), externalRef: receipt.data.external_ref ?? "" },
      native: { id: native.data.id, contactId: native.data.contact_id, slot: { start_iso: native.data.start_at, end_iso: native.data.end_at }, stateJobId: native.data.calendar_state_job_id },
      job: stateJob.data, approval: stateApproval.data, now: new Date().toISOString() });
    if (!effective || !receipt.data.receipt_recorded_at || Date.parse(effective.receiptAt) < Date.parse(receipt.data.receipt_recorded_at)) coverageComplete = false;
    else { stateJobId = effective.stateJobId; effectiveReceiptAt = effective.receiptAt; effectiveSlot = effective.slot; effectiveAccountId = effective.calendarAccountId; }
  }
  const sourceCheck = await admin.rpc("booking_lifecycle_source_check", {
    p_work: nullable(payload.intake_work_id) ?? nullable(payload.customer_rebooking_work_id),
    p_approval: origin, p_state_job: stateJobId,
  });
  if (sourceCheck.error || !sourceCheck.data || typeof sourceCheck.data.allowed !== "boolean") throw new Error("The current receipt-backed booking source could not be checked.");
  const intakeBlock = sourceCheck.data.allowed ? null : String(sourceCheck.data.reason ?? "The booking source or customer instructions changed.");
  const primaryId = nullable(payload.conversation_id);
  const primary = primaryId ? conversations.data?.find((row) => row.id === primaryId) : null;
  if (primaryId && !primary) coverageComplete = false;
  const primaryChannel = authorityChannel(primary?.channel);
  let delivery: BookingLifecycleState["delivery"] = null;
  let sendConnection: string | null = null;
  if (primary && primaryChannel) {
    delivery = { channel: primary.channel as "sms" | "email" | "website_chat" | "instagram", to: primary.external_thread_id };
    sendConnection = primary.connection_id;
  } else if (!primaryId) {
    const phone = nullable(contact.data.phone), email = nullable(contact.data.email);
    delivery = contact.data.preferred_channel === "email" && email ? { channel: "email", to: email }
      : phone ? { channel: "sms", to: phone } : email ? { channel: "email", to: email } : null;
  }
  const channel = authorityChannel(delivery?.channel);
  const authority = channel ? await readEffectiveAuthority(admin, scope, channel, {
    phase: options.phase, approved: options.phase === "execute", expectedRevision: options.expectedRevision, connectionId: sendConnection,
  }) : { allowed: false, reason: "No supported customer destination is available.", revision: 0 };
  if (intakeBlock) { authority.allowed = false; authority.reason = intakeBlock; }
  if (client.data?.status !== "active") { authority.allowed = false; authority.reason = "The business is inactive. No follow-up was sent."; }
  const provider = String(payload.provider ?? "");
  const calendarConnectionId = nullable(payload.calendar_connection_id);
  let calendarAccountId: string | null = null;
  let imports: BookingLifecycleState["imports"] = [];
  if (provider !== "northstar_internal" && calendarConnectionId) {
    const account = await scoped("integration_connections", "id,status,runtime_mode,provider_id,external_account_id,provider:integration_providers!inner(provider_key)")
      .eq("id", calendarConnectionId).maybeSingle();
    if (account.error) throw new Error("The original calendar account could not be checked.");
    const accountProvider = (account.data?.provider as unknown as { provider_key: string } | null)?.provider_key;
    if (!account.data || !["connected", "needs_attention"].includes(account.data.status) || account.data.runtime_mode === "paused" || accountProvider !== provider) coverageComplete = false;
    else {
      calendarAccountId = nullable(account.data.external_account_id);
      if (stateJobId && effectiveAccountId !== calendarAccountId) coverageComplete = false;
      const ids = new Map<string, string | null>([[calendarConnectionId, calendarAccountId]]);
      if (calendarAccountId) {
        const peers = await scoped("integration_connections", "id,external_account_id")
          .eq("provider_id", account.data.provider_id).eq("external_account_id", calendarAccountId)
          .in("status", ["connected", "needs_attention"]).neq("runtime_mode", "paused").limit(101);
        if (peers.error) throw new Error("The exact calendar account coverage could not be checked.");
        if ((peers.data?.length ?? 0) > 100) coverageComplete = false;
        for (const peer of peers.data ?? []) ids.set(peer.id, nullable(peer.external_account_id));
      }
      const [records, streams] = await Promise.all([
        scoped("integration_canonical_records", "id,partner_id,client_id,connection_id,external_object_id,external_updated_at,source_event_at,snapshot_observed_at,native_object_id,canonical_data")
          .in("connection_id", [...ids.keys()]).eq("object_type", "appointment").eq("external_object_id", receipt.data.external_ref ?? "").limit(101),
        scoped("integration_sync_states", "connection_id,status,last_error,cursor_value").in("connection_id", [...ids.keys()]).eq("stream_key", "appointment").limit(101),
      ]);
      if (records.error || streams.error) throw new Error("The current source appointment or reconciliation status could not be checked.");
      if ((streams.data?.length ?? 0) > 100 || (streams.data ?? []).some((stream) => stream.last_error || ["failing", "paused"].includes(stream.status) ||
        stream.cursor_value?.pageToken || stream.cursor_value?.nextLink || stream.cursor_value?.has_more)) coverageComplete = false;
      if ((records.data?.length ?? 0) > 100) coverageComplete = false;
      imports = (records.data ?? []).map((row) => ({
        ...scopedRow(row), id: row.id, connectionId: row.connection_id, externalAccountId: ids.get(row.connection_id) ?? null,
        provider, externalId: row.external_object_id, externalUpdatedAt: nullable(row.external_updated_at), sourceEventAt: nullable(row.source_event_at),
        observedAt: nullable(row.snapshot_observed_at) ?? nullable(row.canonical_data?.observed_at) ?? "",
        deleted: row.canonical_data?.deleted === true, status: String(row.canonical_data?.status ?? "unknown"),
        startAt: String(row.canonical_data?.start_at ?? ""), endAt: String(row.canonical_data?.end_at ?? ""), nativeId: nullable(row.native_object_id),
      }));
    }
  }
  return {
    ...scope, bookingApprovalId: origin, actionJobId: receipt.data.id, approvalStatus: approval.data.status,
    receiptStatus: receipt.data.status, externalRef: nullable(receipt.data.external_ref), receiptAt: effectiveReceiptAt, stateJobId,
    provider, calendarConnectionId, calendarAccountId, startAt: effectiveSlot.start_iso, endAt: effectiveSlot.end_iso,
    nativeLifecycleEnabledAt: nullable(client.data?.native_lifecycle_enabled_at),
    native: { ...scopedRow(native.data), id: native.data.id, approvalId: native.data.approval_id, contactId: native.data.contact_id,
      status: native.data.status, startAt: native.data.start_at, endAt: native.data.end_at, updatedAt: native.data.updated_at, completedAt: nullable(native.data.lifecycle_completed_at) },
    contact: { ...scopedRow(contact.data), id: contact.data.id, updatedAt: contact.data.updated_at, tags: contact.data.tags },
    delivery, latestInbound: latestReceived ? { id: latestReceived.id, at: latestReceived.created_at } : null,
    conversation: primary ? { id: primary.id, revision: primary.revision, mode: primary.mode, optedOut: primary.opted_out, state: primary.state } : null,
    otherHumanTakeover: (conversations.data ?? []).some((row) => row.mode === "human" && row.state !== "closed"),
    cancellationRequested: receipt.data.booking_followup_phase === "stopped" || !!stopTask.data?.length,
    coverageComplete, imports, authority,
  };
}

/** Used at dispatch start and after token/availability waits, before the write. */
export async function bookingLifecycleDeliveryBlock(admin: SupabaseClient, job: ActionJobRecord, now = new Date().toISOString()): Promise<string | null> {
  if (["calendar.cancel", "calendar.reschedule"].includes(job.kind)) return null; // Dedicated approved-mutation source guard owns this path.
  const payload = job.payload;
  const lifecycle = payload.booking_lifecycle_version !== undefined || payload.booking_followup_kind !== undefined;
  if (!lifecycle) {
    if (payload.booking_approval_id || payload.draft_source === "booking_confirmation_template")
      return "This old booking follow-up has no reviewed source version. Recover a current proposal before sending.";
    if (job.workflow_run_id && ["email.send", "sms.send"].includes(job.kind)) {
      const run = await admin.from("workflow_runs").select("template:workflow_templates(template_key)")
        .eq("id", job.workflow_run_id).eq("partner_id", job.partner_id).eq("client_id", job.client_id).maybeSingle();
      if (run.error) throw new Error("The source message workflow could not be verified.");
      const key = (run.data?.template as unknown as { template_key?: string } | null)?.template_key;
      if (key === "appointment_reminder") return "This legacy appointment reminder has no current source pins. Prepare a verified reminder instead.";
    }
    return null;
  }
  const pin = readBookingLifecyclePin(payload);
  if (!pin) return "This booking follow-up has invalid source pins. Prepare a fresh proposal.";
  const state = await readBookingLifecycleState(admin, { partnerId: job.partner_id, clientId: job.client_id }, pin.booking_approval_id,
    { phase: "execute", actionJobId: pin.booking_action_job_id, expectedRevision: pin.authority_revision });
  if (!state) return "The exact original booking and customer are unavailable. Nothing was sent.";
  const decision = evaluateBookingLifecycle(state, { kind: pin.booking_followup_kind, now, pin, explicitOwnerRequest: pin.booking_followup_kind === "rebooking" });
  return decision.state === "ready" ? null : decision.reason;
}

export async function inspectBookingFollowup(admin: SupabaseClient, scope: Scope, origin: string, kind: BookingFollowupKind, now: string, actionJobId?: string) {
  const state = await readBookingLifecycleState(admin, scope, origin, { phase: "draft", actionJobId });
  return state ? evaluateBookingLifecycle(state, { kind, now, explicitOwnerRequest: kind === "rebooking" })
    : { state: "blocked" as const, reason: "The exact original booking and customer are unavailable." };
}
