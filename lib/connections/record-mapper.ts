import type { ConnectedApp, ConnectedData, SyncedMessage, SyncedAppointment, SyncedLead, SyncedInvoice, SyncedPayment } from "./types.ts";
import type { ImportedRow } from "./records.ts";
import { knownCurrency, minorAmount } from "./money.ts";

const str = (v: unknown) => typeof v === "string" ? v : "";
const timestamp = (v: unknown): string | null => typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null;
const outlookHosts = ["outlook.office.com", "outlook.office365.com", "outlook.live.com"];
export function safeProviderLink(value: unknown, provider: string, kind: string): string | null {
  try {
    const url = new URL(str(value));
    const hosts = provider === "google_workspace" ? kind === "appointment" ? ["calendar.google.com", "www.google.com"] : ["mail.google.com"]
      : provider === "microsoft_365" ? outlookHosts
        : provider === "stripe" ? ["invoice.stripe.com", "pay.stripe.com", "receipt.stripe.com", "checkout.stripe.com", "dashboard.stripe.com"] : [];
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
/** Replays/edits replace only their exact account/object source identity. Latest tombstones suppress old snapshots. */
export function latestImportedRows(rows: ImportedRow[]): ImportedRow[] {
  const latest = new Map<string, ImportedRow>();
  for (const row of rows) {
    const key = `${row.connection_id}:${row.object_type}:${row.external_object_id}`;
    const old = latest.get(key);
    const clock = timestamp(row.updated_at) ?? timestamp(row.external_updated_at);
    const prior = old && (timestamp(old.updated_at) ?? timestamp(old.external_updated_at));
    if (!old || !prior || (!!clock && Date.parse(clock) >= Date.parse(prior))) latest.set(key, row);
  }
  return [...latest.values()];
}
function direction(data: Record<string, unknown>, provider: string): "inbound" | "outbound" | "unknown" {
  if (data.direction === "inbound" || data.direction === "outbound") return data.direction;
  const labels = Array.isArray(data.labels) ? data.labels : [];
  if (provider === "google_workspace" && labels.includes("SENT")) return "outbound";
  if (provider === "google_workspace" && labels.includes("INBOX")) return "inbound";
  return data.inbound === true ? "inbound" : "unknown";
}

/** Only allowlisted normalized display fields leave the server. No bodies, raw payloads, customer identifiers or configuration. */
export function mapConnectedData(apps: ConnectedApp[], rows: ImportedRow[], generatedAt = new Date().toISOString()): ConnectedData {
  const accounts = new Map(apps.filter((app) => ["connected", "needs_attention"].includes(app.status)).map((app) => [app.id, app]));
  const messages = new Map<string, SyncedMessage>();
  const appointments: SyncedAppointment[] = [], leads: SyncedLead[] = [], invoices: SyncedInvoice[] = [], payments: SyncedPayment[] = [];
  for (const row of latestImportedRows(rows)) {
    const app = accounts.get(row.connection_id), d = row.canonical_data;
    if (!app || !d || d.deleted === true) continue;
    const account = app.account || app.name, provider = app.provider;
    if (row.object_type === "message" && ["google_workspace", "microsoft_365"].includes(provider)) {
      const labels = Array.isArray(d.labels) ? d.labels : [];
      if (d.is_draft === true || labels.some((label) => ["TRASH", "SPAM", "DRAFT"].includes(str(label))) || ["deleteditems", "junkemail", "drafts"].includes(str(d.folder).toLowerCase())) continue;
      const receivedAt = timestamp(d.received_at) ?? timestamp(d.sent_at) ?? timestamp(row.external_updated_at);
      if (!receivedAt || Date.parse(receivedAt) < Date.parse(generatedAt) - 30 * 86400000) continue;
      const threadId = row.external_parent_id || row.external_object_id, key = `${app.id}:${threadId}`;
      const flow = direction(d, provider);
      const inbox = d.inbox === true || labels.includes("INBOX") || (d.inbox !== false && provider === "microsoft_365" && flow === "inbound" && d.folder === "inbox");
      const prior = messages.get(key), newer = !prior || Date.parse(receivedAt) >= Date.parse(prior.receivedAt ?? "");
      const href = provider === "google_workspace" && /^[a-zA-Z0-9_-]+$/.test(threadId)
        ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(app.account || "")}#all/${threadId}`
        : safeProviderLink(d.html_url ?? d.web_url, provider, "message");
      const message: SyncedMessage = {
        id: row.id, connectionId: app.id, threadId, subject: str(d.subject).slice(0, 500) || "(No subject)",
        from: (str(d.from) || str(d.sender)).slice(0, 320), preview: str(d.preview).slice(0, 1000), receivedAt,
        unread: d.is_read === false, inbox, account, href, messageCount: (prior?.messageCount ?? 0) + 1, provider, direction: flow,
      };
      messages.set(key, { ...(newer ? message : prior!), unread: message.unread || !!prior?.unread, inbox: message.inbox || !!prior?.inbox, messageCount: message.messageCount });
    }
    if (row.object_type === "appointment" && ["google_workspace", "microsoft_365"].includes(provider)) {
      const startAt = timestamp(d.start_at), endAt = timestamp(d.end_at), status = str(d.status);
      if (["cancelled", "canceled", "deleted"].includes(status) || !startAt || !endAt || Date.parse(endAt) < Date.parse(startAt)) continue;
      appointments.push({ id: row.id, nativeId: row.native_object_id, title: str(d.title).slice(0, 500) || "Appointment", startAt, endAt,
        allDay: d.all_day === true || /^\d{4}-\d{2}-\d{2}$/.test(startAt), account,
        href: safeProviderLink(d.html_url, provider, "appointment"), connectionId: app.id, provider,
        status: status === "confirmed" ? "booked" : status === "tentative" ? "proposed" : status || "unknown" });
    }
    if (row.object_type === "lead" && provider === "generic_inbound_webhook" && d.status !== "deleted") {
      leads.push({ id: row.id, connectionId: app.id, externalId: row.external_object_id, nativeId: row.native_object_id,
        account, provider, title: str(d.title).slice(0, 300) || "Intake submission", status: str(d.status) || "unknown",
        receivedAt: timestamp(d.received_at) ?? timestamp(row.external_updated_at), href: null,
        preview: (str(d.description) || str(d.message)).slice(0, 1200) });
    }
    if (provider === "stripe" && row.object_type === "invoice") {
      invoices.push({ id: row.id, connectionId: app.id, externalId: row.external_object_id, account, provider,
        number: str(d.number).slice(0, 100) || null, status: str(d.status) || "unknown", currency: knownCurrency(d.currency),
        totalMinor: minorAmount(d.total_minor ?? d.total), amountDueMinor: minorAmount(d.amount_due_minor ?? d.amount_remaining),
        amountPaidMinor: minorAmount(d.amount_paid_minor ?? d.amount_paid), dueAt: timestamp(d.due_date),
        updatedAt: timestamp(row.updated_at) ?? timestamp(row.external_updated_at), href: safeProviderLink(d.hosted_url, provider, "invoice") });
    }
    if (provider === "stripe" && row.object_type === "payment") {
      payments.push({ id: row.id, connectionId: app.id, externalId: row.external_object_id, account, provider,
        status: str(d.status) || "unknown", currency: knownCurrency(d.currency),
        amountMinor: minorAmount(Object.hasOwn(d, "amount_minor") ? d.amount_minor : d.amount_received), amountRefundedMinor: minorAmount(d.amount_refunded_minor ?? d.amount_refunded),
        updatedAt: timestamp(row.updated_at) ?? timestamp(row.external_updated_at), href: safeProviderLink(d.receipt_url, provider, "payment") });
    }
  }
  return { apps, messages: [...messages.values()].sort((a, b) => (b.receivedAt || "").localeCompare(a.receivedAt || "")),
    appointments: appointments.sort((a, b) => a.startAt.localeCompare(b.startAt)), leads, invoices, payments, limited: false, errors: [], generatedAt };
}
