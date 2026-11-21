import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record";
import { bookingConfirmationBlock, confirmationContactSuppressed } from "./confirmation-rules.ts";

export async function confirmationDeliveryBlock(admin: SupabaseClient, job: ActionJobRecord, now = new Date().toISOString()): Promise<string | null> {
  const origin = job.payload.booking_approval_id;
  if (!origin) return job.payload.draft_source === "booking_confirmation_template" ? "This old confirmation lacks its booking source. Prepare a fresh confirmation." : null;
  if (typeof origin !== "string" || !/^[0-9a-f-]{36}$/i.test(origin)) return "The confirmation booking source is invalid.";
  const scoped = <Columns extends string>(table: string, columns: Columns) => admin.from(table).select(columns).eq("partner_id", job.partner_id).eq("client_id", job.client_id);
  const [approval, receipt, appointment] = await Promise.all([
    scoped("approval_items", "status,proposed_payload").eq("id", origin).eq("type", "appointment_booking").maybeSingle(),
    scoped("action_jobs", "status,external_ref,updated_at,receipt_recorded_at").eq("approval_id", origin).eq("kind", "calendar.book").maybeSingle(),
    scoped("crm_appointments", "id,status,start_at,end_at,contact_id").eq("approval_id", origin).maybeSingle(),
  ]);
  if (approval.error || receipt.error || appointment.error) throw new Error("The booking source could not be rechecked.");
  if (!approval.data || !receipt.data) return "The original successful booking is unavailable. No confirmation was sent.";
  const payload = approval.data.proposed_payload as Record<string, unknown>;
  const slot = payload.slot as { start_iso?: string; end_iso?: string } | undefined;
  let optedOut = false;
  const contactId = typeof payload.contact_id === "string" ? payload.contact_id : appointment.data?.contact_id;
  if (!contactId) return "The exact booked customer identity is unavailable. Review contact preferences before confirmation.";
  if (contactId) {
    const contact = await scoped("crm_contacts", "tags").eq("id", contactId).maybeSingle();
    if (contact.error) throw new Error("Customer contact preferences could not be rechecked.");
    if (!contact.data) return "The booked customer record is unavailable.";
    if (!Array.isArray(contact.data.tags)) return "Customer contact preferences are unavailable. Review before confirmation.";
    optedOut = confirmationContactSuppressed(contact.data.tags);
  }
  const internal = payload.provider === "northstar_internal";
  let imports: Parameters<typeof bookingConfirmationBlock>[0]["imports"] = [];
  if (!internal) {
    if (typeof payload.calendar_connection_id !== "string") return "The original calendar account binding is unavailable.";
    const account = await scoped("integration_connections", "id,provider_id,external_account_id,status,runtime_mode").eq("id", payload.calendar_connection_id).maybeSingle();
    if (account.error) throw new Error("The calendar account could not be checked.");
    if (!account.data || account.data.status !== "connected" || account.data.runtime_mode === "paused") return "The booked calendar is paused or unavailable. Reconnect before confirmation.";
    const ids = [account.data.id];
    if (account.data.external_account_id) {
      const peers = await scoped("integration_connections", "id").eq("provider_id", account.data.provider_id).eq("external_account_id", account.data.external_account_id).in("status", ["connected", "needs_attention"]).limit(101);
      if (peers.error) throw new Error("Calendar source accounts could not be checked.");
      if ((peers.data?.length ?? 0) > 100) return "Calendar account coverage is incomplete. Review the booking source.";
      ids.push(...(peers.data ?? []).map((row) => row.id));
    }
    const records = await scoped("integration_canonical_records", "external_object_id,canonical_data,snapshot_observed_at,native_object_id")
      .in("connection_id", [...new Set(ids)]).eq("object_type", "appointment").eq("external_object_id", receipt.data.external_ref ?? "").limit(101);
    if (records.error) throw new Error("Current source appointments could not be rechecked.");
    if ((records.data?.length ?? 0) > 100) return "Calendar source coverage is incomplete. Review the booking.";
    imports = (records.data ?? []).map((row) => ({ externalId: row.external_object_id, accountBound: true, observedAt: row.snapshot_observed_at ?? (typeof row.canonical_data.observed_at === "string" ? row.canonical_data.observed_at : ""), nativeId: row.native_object_id,
      deleted: row.canonical_data.deleted === true, status: String(row.canonical_data.status ?? "unknown"), startAt: String(row.canonical_data.start_at ?? ""), endAt: String(row.canonical_data.end_at ?? "") }));
  }
  return bookingConfirmationBlock({ approvalStatus: approval.data.status, receiptStatus: receipt.data.status, externalRef: receipt.data.external_ref,
    receiptAt: receipt.data.receipt_recorded_at ?? receipt.data.updated_at, startAt: slot?.start_iso ?? "", endAt: slot?.end_iso ?? "", internal, optedOut,
    native: appointment.data ? { id: appointment.data.id, status: appointment.data.status, startAt: appointment.data.start_at, endAt: appointment.data.end_at } : null,
    imports }, now);
}
