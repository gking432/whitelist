// CRM outbound sync adapter abstraction — CONTRACT ONLY (Phase 5 of
// docs/11). CRM sync is required plumbing, not a product pack: outputs from
// workflows, voice, and scheduling must land in the client's existing CRM
// so the client business never needs to live inside this platform.
//
// Northstar reference concepts carried over: dry-run vs live modes with
// identical payload construction, payload preview before anything is sent,
// and a per-attempt sync event log. In this platform every sync attempt is
// recorded as an integration_event (direction "outbound") with redacted
// request/response payloads, and manual retries are permission-checked and
// audited.

import type { RuntimeMode } from "@/lib/clients/constants";

export type CrmEntityType = "contact" | "deal" | "note" | "task" | "appointment";

// A provider-neutral record produced by workflows/voice/scheduling. The
// adapter maps it to provider-specific fields using the connection's field
// mapping configuration.
export type CrmSyncRecord = {
  partnerId: string;
  clientId: string;
  entityType: CrmEntityType;
  sourceRunId: string | null;
  idempotencyKey: string;
  fields: Record<string, string | number | boolean | null>;
  // Clean AI note vs raw context stays separated: notes carry the CRM-ready
  // summary only, never full transcripts or raw payloads.
  noteBody?: string;
};

export type FieldMapping = {
  // platform field -> provider field, configured per connection by the
  // partner (Integrations tab). Unmapped fields are dropped, never guessed.
  entityType: CrmEntityType;
  map: Record<string, string>;
};

export type CrmSyncOutcome =
  | {
      status: "dry_run";
      // Exact payload that live mode would send — the preview surface.
      payloadPreview: Record<string, unknown>;
    }
  | {
      status: "synced";
      externalId: string;
      payloadPreview: Record<string, unknown>;
    }
  | {
      status: "failed";
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    }
  | { status: "skipped"; reason: "duplicate_idempotency_key" | "not_mapped" };

export interface CrmSyncAdapter {
  providerKey: string; // e.g. "hubspot", "generic_outbound_webhook"

  validateConnection(connectionId: string): Promise<{
    ok: boolean;
    detail: string;
  }>;

  // Pure payload construction — identical output in dry_run and live so the
  // preview is always truthful.
  buildPayload(
    record: CrmSyncRecord,
    mapping: FieldMapping | null,
  ): Record<string, unknown>;

  // Mode comes from the connection's runtime mode: sandbox/dry_run never
  // touch the external CRM; live requires configured credentials and, where
  // policy says so, a resolved approval.
  sync(
    record: CrmSyncRecord,
    mapping: FieldMapping | null,
    mode: RuntimeMode,
  ): Promise<CrmSyncOutcome>;
}

// Retry contract: a failed outbound sync surfaces in Runs/Logs with a
// permission-checked manual retry (partner operator roles), a fresh
// integration_event per attempt, and an audit event on each retry.
export type CrmRetryRequest = {
  integrationEventId: string;
  requestedByUserId: string;
};
