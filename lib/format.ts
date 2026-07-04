const enumLabels: Record<string, string> = {
  external_crm_only: "External CRM",
  mirror: "Mirror",
  assist: "Assist",
  primary_crm: "Primary CRM",
  webhook_only: "Webhook only",
  none: "None",
  sandbox: "Sandbox",
  dry_run: "Dry run",
  live: "Live",
  paused: "Paused",
  onboarding: "Onboarding",
  active: "Active",
  at_risk: "At risk",
  archived: "Archived",
  trial: "Trial",
  suspended: "Suspended",
  not_connected: "Not connected",
  connected: "Connected",
  needs_attention: "Needs attention",
  failing: "Failing",
  disabled: "Disabled",
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  paused_for_approval: "Awaiting approval",
  skipped: "Skipped",
  cancelled: "Cancelled",
  pending: "Pending",
  approved: "Approved",
  edited_and_approved: "Edited & approved",
  rejected: "Rejected",
  expired: "Expired",
  received: "Received",
  processed: "Processed",
  sent: "Sent",
  inbound: "Inbound",
  outbound: "Outbound",
  low: "Low",
  medium: "Medium",
  high: "High",
  missing: "Missing",
  configured: "Configured",
  invalid: "Invalid",
  rotating: "Rotating",
  healthy: "Healthy",
  attention: "Attention",
  unknown: "Unknown",
  crm: "CRM",
  inbound_webhook: "Inbound webhook",
  outbound_webhook: "Outbound webhook",
  phone: "Phone",
  sms: "SMS",
  email: "Email",
  calendar: "Calendar",
  sales: "Sales",
  service: "Service",
  operations: "Operations",
  reporting: "Reporting",
  systems: "Systems",
};

export function formatEnum(value: string): string {
  return enumLabels[value] ?? value.replaceAll("_", " ");
}

export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
