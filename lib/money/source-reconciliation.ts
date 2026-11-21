import type { SyncedInvoice, SyncedPayment } from "../connections/types.ts";

export type MoneySourceRecord = { id: string; connectionId: string; account: string; href: string | null };
export type MoneySourcePresentation = { sourceRecords: MoneySourceRecord[]; sourceWarning: string | null };
type MoneySource = { id: string; connectionId: string; externalId: string; account: string; accountId?: string | null; provider: string; href: string | null };
const sameTime = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : value;
const verifiedSource = (row: MoneySource) => row.provider === "stripe" && typeof row.accountId === "string" &&
  /^acct_[A-Za-z0-9_]{1,250}$/.test(row.accountId) && !!row.externalId && row.externalId.trim() === row.externalId;
const byId = (a: MoneySource, b: MoneySource) => a.id.localeCompare(b.id) || a.connectionId.localeCompare(b.connectionId);

function reconcile<T extends MoneySource>(rows: T[], kind: "invoice" | "payment", facts: (row: T) => string, conflictRow: (row: T) => T) {
  const groups = new Map<string, T[]>();
  const ambiguousOverlap = new Set<T>();
  rows.forEach((row, index) => {
    if (row.provider !== "stripe" || !row.externalId) return;
    for (const other of rows.slice(index + 1)) {
      if (other.provider === "stripe" && other.externalId === row.externalId && other.connectionId !== row.connectionId &&
          (!verifiedSource(row) || !verifiedSource(other))) {
        ambiguousOverlap.add(row);
        ambiguousOverlap.add(other);
      }
    }
  });
  let unverifiedCount = 0;
  rows.forEach((row, index) => {
    const verified = verifiedSource(row);
    if (row.provider === "stripe" && !verified) unverifiedCount++;
    // Unknown account identities, display labels and customer details never
    // establish sameness, even when their source IDs or amounts coincide.
    const key = verified ? JSON.stringify(["stripe", row.accountId, row.externalId]) : JSON.stringify(["separate", index]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  });
  let duplicateCount = 0, conflictCount = 0;
  const records: (T & MoneySourcePresentation)[] = [];
  for (const group of groups.values()) {
    const sources = [...group].sort(byId), chosen = sources[0];
    const overlap = sources.some((row) => ambiguousOverlap.has(row));
    const conflict = overlap || sources.some((row) => facts(row) !== facts(chosen));
    if (conflict) conflictCount++;
    else duplicateCount += sources.length - 1;
    const sourceWarning = overlap ? `Another import of this Stripe ${kind} lacks verified account identity. These separate records may overlap; financial amounts are excluded until source review.` :
      conflict ? `Imported sources disagree about this ${kind}. Its financial amounts are unavailable until the exact source is reviewed.` :
      sources.length > 1 ? `${sources.length} imports agree for this verified Stripe ${kind}; it is shown once.` :
        chosen.provider === "stripe" && !verifiedSource(chosen) ? `The Stripe account or source identity is unverified. This ${kind} remains separate and may overlap another import.` : null;
    records.push({ ...(conflict ? conflictRow(chosen) : chosen), sourceWarning,
      sourceRecords: sources.map(({ id, connectionId, account, href }) => ({ id, connectionId, account, href })) });
  }
  return { records, duplicateCount, conflictCount, unverifiedCount };
}

/** Reconcile only exact verified Stripe source identities. This does not infer
 * customer identity, choose which conflicting financial source is correct,
 * or write anything back to a provider or imported record. */
export function reconcileMoneySources(invoices: SyncedInvoice[] = [], payments: SyncedPayment[] = []) {
  const invoice = reconcile(invoices, "invoice", (row) => JSON.stringify([row.status, row.currency, row.amountDueMinor, row.amountPaidMinor, row.totalMinor, sameTime(row.dueAt)]),
    (row) => ({ ...row, status: "source_conflict", amountDueMinor: null, amountPaidMinor: null, totalMinor: null, currency: null, dueAt: null }));
  const payment = reconcile(payments, "payment", (row) => JSON.stringify([row.status, row.currency, row.amountMinor, row.amountRefundedMinor]),
    (row) => ({ ...row, status: "source_conflict", amountMinor: null, amountRefundedMinor: null, currency: null }));
  const sourceWarnings = [
    ...(invoice.duplicateCount ? [`${invoice.duplicateCount} repeated invoice ${invoice.duplicateCount === 1 ? "import is" : "imports are"} shown once using verified Stripe account and invoice IDs.`] : []),
    ...(payment.duplicateCount ? [`${payment.duplicateCount} repeated payment ${payment.duplicateCount === 1 ? "import is" : "imports are"} shown once using verified Stripe account and payment IDs.`] : []),
    ...(invoice.conflictCount ? [`${invoice.conflictCount} ${invoice.conflictCount === 1 ? "invoice has" : "invoices have"} conflicting or overlapping source facts and ${invoice.conflictCount === 1 ? "is" : "are"} excluded from outstanding totals. Review the source before outreach.`] : []),
    ...(payment.conflictCount ? [`${payment.conflictCount} ${payment.conflictCount === 1 ? "payment has" : "payments have"} conflicting or overlapping source facts. Collected and refunded amounts remain unknown.`] : []),
    ...(invoice.unverifiedCount ? [`${invoice.unverifiedCount} Stripe invoice ${invoice.unverifiedCount === 1 ? "record lacks" : "records lack"} verified account or source identity and ${invoice.unverifiedCount === 1 ? "is" : "are"} kept separate. Ambiguous overlapping balances are excluded from loaded subtotals.`] : []),
    ...(payment.unverifiedCount ? [`${payment.unverifiedCount} Stripe payment ${payment.unverifiedCount === 1 ? "record lacks" : "records lack"} verified account or source identity and ${payment.unverifiedCount === 1 ? "is" : "are"} shown separately. Overlap cannot be ruled out.`] : []),
  ];
  return { invoices: invoice.records, payments: payment.records, sourceWarnings,
    duplicateCount: invoice.duplicateCount + payment.duplicateCount, conflictCount: invoice.conflictCount + payment.conflictCount };
}

/** Keep every provenance row in shared evidence, while assigning financial
 * amounts to only one stable record for a verified duplicated source. */
type InvoiceEvidence = SyncedInvoice & MoneySourcePresentation;
type PaymentEvidence = SyncedPayment & MoneySourcePresentation;
export function moneyEvidenceForSource(record: InvoiceEvidence, sourceId: string): InvoiceEvidence;
export function moneyEvidenceForSource(record: PaymentEvidence, sourceId: string): PaymentEvidence;
export function moneyEvidenceForSource(record: InvoiceEvidence | PaymentEvidence, sourceId: string): InvoiceEvidence | PaymentEvidence {
  if (record.id === sourceId || record.status === "source_conflict") return record;
  const sourceWarning = `Duplicate source of verified financial evidence ${record.id}. Amounts are reported only on that record; this row preserves its separate source identity.`;
  return "amountDueMinor" in record
    ? { ...record, status: "duplicate_source", currency: null, amountDueMinor: null, amountPaidMinor: null, totalMinor: null, dueAt: null, sourceWarning }
    : { ...record, status: "duplicate_source", currency: null, amountMinor: null, amountRefundedMinor: null, sourceWarning };
}
