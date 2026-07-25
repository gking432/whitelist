export const CLIENT_STATUSES = [
  "onboarding",
  "active",
  "paused",
  "at_risk",
  "archived",
] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CRM_OPERATING_MODES = [
  "external_crm_only",
  "mirror",
  "assist",
  "primary_crm",
  "webhook_only",
  "none",
] as const;

export type CrmOperatingMode = (typeof CRM_OPERATING_MODES)[number];

export const RUNTIME_MODES = ["sandbox", "dry_run", "live", "paused"] as const;

export type RuntimeMode = (typeof RUNTIME_MODES)[number];

export const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
] as const;

export type ClientBusinessRecord = {
  id: string;
  partner_id: string;
  name: string;
  slug: string;
  status: ClientStatus;
  industry: string | null;
  crm_operating_mode: CrmOperatingMode;
  default_runtime_mode: RuntimeMode;
  website_url: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  timezone: string;
  client_portal_enabled: boolean;
  partner_can_edit_client_data: boolean;
  lead_source_profile: Record<string, unknown> | null;
  package_id: string | null;
  account_kind: "managed_client" | "partner_agency";
  is_test_account: boolean;
  created_at: string;
  updated_at: string;
};
