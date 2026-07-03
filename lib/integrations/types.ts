import type { RuntimeMode } from "@/lib/clients/constants";

export const INTEGRATION_STATUSES = [
  "not_connected",
  "connected",
  "needs_attention",
  "failing",
  "paused",
  "disabled",
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export type IntegrationProviderRecord = {
  id: string;
  provider_key: string;
  display_name: string;
  category: string;
  supports_inbound: boolean;
  supports_outbound: boolean;
  supports_oauth: boolean;
  supports_api_key: boolean;
  is_active: boolean;
};

export type IntegrationConnectionRecord = {
  id: string;
  partner_id: string;
  client_id: string;
  provider_id: string;
  display_name: string;
  status: IntegrationStatus;
  runtime_mode: RuntimeMode;
  credential_status: "missing" | "configured" | "invalid" | "rotating";
  config: Record<string, unknown>;
  health_summary: string | null;
  error_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationEventRecord = {
  id: string;
  connection_id: string | null;
  workflow_run_id: string | null;
  direction: "inbound" | "outbound";
  event_type: string;
  status: "received" | "processed" | "rejected" | "failed" | "skipped";
  idempotency_key: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

export const INBOUND_WEBHOOK_PROVIDER_KEY = "generic_inbound_webhook";
export const OUTBOUND_WEBHOOK_PROVIDER_KEY = "generic_outbound_webhook";

export function isFunctionalProvider(providerKey: string): boolean {
  return providerKey === INBOUND_WEBHOOK_PROVIDER_KEY;
}

export function inboundWebhookPath(connectionId: string): string {
  return `/api/integrations/inbound/${connectionId}`;
}
