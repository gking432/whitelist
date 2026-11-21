import type { ConnectedData } from "../connections/types.ts";
import { connectedStreamWarnings, relevantConnectedApps } from "./daily-brief.ts";

/** Isolate source outages from the decision inbox's existing availability gate. */
export async function loadMobileConnectedSource(load: () => Promise<ConnectedData>) {
  try {
    return { connectedData: await load(), connectedDataError: null };
  } catch {
    return {
      connectedData: undefined,
      connectedDataError: "Connected business updates could not be loaded. Refresh or check Apps. Your decisions use their own current checks.",
    };
  }
}

export function buildMobileSourceSummary(data?: ConnectedData, loadError?: string | null) {
  const counts = data ? {
    inquiries: data.leads?.length ?? 0,
    invoices: data.invoices?.length ?? 0,
    payments: data.payments?.length ?? 0,
  } : null;
  const hasRecords = !!counts && counts.inquiries + counts.invoices + counts.payments > 0;
  const sources = data ? relevantConnectedApps(data, ["lead", "invoice", "payment"]) : [];
  const notices = data ? [
    ...data.errors,
    ...(data.limited ? ["This is a bounded set of imported records. Open the source apps for their complete records."] : []),
    ...(!counts?.inquiries ? connectedStreamWarnings(data, ["lead"]) : []),
    ...(!counts?.invoices && !counts?.payments ? connectedStreamWarnings(data, ["invoice", "payment"]) : []),
  ] : [];
  const recordLabel = counts && hasRecords ? [
    counts.inquiries ? `${counts.inquiries} form ${counts.inquiries === 1 ? "inquiry" : "inquiries"}` : "",
    counts.invoices ? `${counts.invoices} imported ${counts.invoices === 1 ? "invoice" : "invoices"}` : "",
    counts.payments ? `${counts.payments} payment ${counts.payments === 1 ? "record" : "records"}` : "",
  ].filter(Boolean).join(" · ") : loadError ? "Updates unavailable" : "Waiting for imported business records";
  return {
    visible: hasRecords || sources.length > 0 || !!loadError,
    counts,
    hasRecords,
    label: data?.limited && hasRecords ? `Loaded sample: ${recordLabel}` : recordLabel,
    notices: [...new Set(notices)],
    generatedAt: data?.generatedAt && Number.isFinite(Date.parse(data.generatedAt)) ? data.generatedAt : null,
  };
}
