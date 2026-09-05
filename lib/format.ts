const enumLabels: Record<string, string> = {
  external_crm_only: "Keep existing CRM",
  mirror: "Copy CRM activity",
  assist: "Assist existing CRM",
  primary_crm: "Built-in CRM",
  webhook_only: "App events only",
  none: "None",
  sandbox: "Test mode",
  dry_run: "Preview only",
  live: "Live",
  paused: "Paused",
  onboarding: "Setting up",
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
  succeeded: "Completed",
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
  inbound: "Incoming",
  outbound: "Outgoing",
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
  provider_pending: "Waiting for the app",
  uncertain: "Needs delivery review",
  "sms.send": "Send text message",
  "email.send": "Send email",
  "calendar.book": "Book appointment",
  "crm.sync": "Update CRM",
  "external.action": "Update connected app",
  crm: "CRM",
  inbound_webhook: "Receive app events",
  outbound_webhook: "Send app events",
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
