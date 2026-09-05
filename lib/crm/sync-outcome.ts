/** Legacy CRM contact+note writes are multi-step and not safely replayable. */
export function crmSyncDeliveryStatus(status: string): "succeeded" | "dry_run" | "uncertain" | "skipped" {
  if (status === "synced") return "succeeded";
  if (status === "dry_run") return "dry_run";
  if (status === "failed" || status === "uncertain") return "uncertain";
  return "skipped";
}

/** Old failed rows predate uncertainty classification and may already exist at the provider. */
export function legacyCrmSyncNeedsReconciliation(job: { kind: string; status: string }): boolean {
  return job.kind === "crm.sync" && job.status === "failed";
}
