export type WorkspaceProvider = "google_workspace" | "microsoft_365";
export type ActivationChoices = {
  inquiries: boolean;
  bookings: boolean;
  website: boolean;
  email: boolean;
  instagram: boolean;
  sms: boolean;
  workspace_provider: WorkspaceProvider;
  workspace_connection_id?: string | null;
  booking_start_hour: number;
  booking_end_hour: number;
  booking_minutes: number;
  booking_weekdays: number[];
  timezone: string;
};
export type ActivationPlan = ActivationChoices & {
  client_id: string;
  partner_id: string;
  revision: number;
  status: "active" | "paused";
  workspace_connection_id: string | null;
  updated_at: string;
};
export type ActivationCheck = {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
};
export type ActivationSnapshot = {
  plan: ActivationPlan | null;
  canWrite: boolean;
  recommendedBookings: boolean;
  checks: ActivationCheck[];
  status: "not_started" | "paused" | "needs_attention" | "running";
  accounts: {
    provider: WorkspaceProvider;
    name: string;
    available: boolean;
    connected: boolean;
  }[];
  workspaceAccounts?: { id: string; provider: WorkspaceProvider; account: string; status: string; paused: boolean; calendarWrite: boolean; emailSend: boolean; importOnly: boolean }[];
  widgetUrl: string | null;
  widgetSnippet: string | null;
  workspaceAccount: string | null;
};
