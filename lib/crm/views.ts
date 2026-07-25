export const CRM_VIEWS = [
  "overview",
  "pipeline",
  "contacts",
  "tasks",
  "inbox",
  "schedule",
  "calls",
  "quotes",
  "feedback",
  "automations",
  "reports",
  "crm-sync",
  "settings",
] as const;

export type CrmView = (typeof CRM_VIEWS)[number];

export function parseCrmView(value: string | undefined): CrmView {
  return CRM_VIEWS.includes(value as CrmView)
    ? (value as CrmView)
    : "overview";
}
