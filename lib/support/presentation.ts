export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  new: "New",
  triaged: "Triaged",
  waiting_requester: "Waiting for reply",
  partner_working: "Partner working",
  escalated: "Escalated",
  platform_working: "Platform working",
  validation: "Ready to validate",
  resolved: "Resolved",
  closed: "Closed",
};

export function supportStatusLabel(status: string) {
  return SUPPORT_STATUS_LABELS[status] ?? status.replaceAll("_", " ");
}

export function supportReference(id: string) {
  return `SUP-${id.slice(0, 8).toUpperCase()}`;
}

