const INTERNAL_CRM_MODES = new Set(["primary_crm", "mirror", "assist"]);

export function shouldProjectConnectorRecord(crmOperatingMode: string) {
  return INTERNAL_CRM_MODES.has(crmOperatingMode);
}

export function staleConnectorJobDisposition(direction: string) {
  return direction === "pull" ? "failed" : "dead_letter";
}

export function connectorLeaseCutoff(
  now = new Date(),
  leaseMilliseconds = 5 * 60_000,
) {
  return new Date(now.getTime() - leaseMilliseconds).toISOString();
}
