import type { BusinessProfile } from "./types.ts";

/** Public v1 contract: never include credentials or raw provider payloads. */
export const BUSINESS_CONTEXT_VERSION = 1 as const;
export const AUTHORITY_MODES = ["off", "observe", "draft", "require_approval"] as const;
export type AuthorityMode = (typeof AUTHORITY_MODES)[number];
export const AUTHORITY_CHANNELS = ["website", "email", "sms", "instagram", "calendar"] as const;
export type AuthorityChannel = (typeof AUTHORITY_CHANNELS)[number];
export type BusinessAuthority = {
  revision: number;
  status: "active" | "paused";
  channels: Record<AuthorityChannel, AuthorityMode>;
};
export type ContextSource = {
  table: string;
  id: string;
  revision: string;
  updatedAt: string | null;
};
export type ContextFact = {
  key: keyof BusinessProfile;
  value: string | string[];
  state: "known" | "unknown" | "conflict";
  reviewed: boolean;
  sources: ContextSource[];
};
export type ContextCoverage = {
  key: string;
  label: string;
  connectionId: string | null;
  capability: string;
  status: "fresh" | "stale" | "missing" | "error";
  lastUpdatedAt: string | null;
  sampled: number;
  limit: number;
  hasMore: boolean;
  detail: string;
};
export type ContextRecommendation = {
  key: string;
  label: string;
  reason: string;
  prerequisites: string[];
};
export type ContextObservation = {
  key: string;
  summary: string;
  since: string;
  sources: ContextSource[];
  limitation: string;
};
export type ContextRecord = {
  id: string;
  table: string;
  kind: string;
  title: string;
  summary?: string;
  status: string;
  revision: string;
  updatedAt: string;
  sourceRecordId?: string;
  startAt?: string;
  connectionId?: string;
  externalId?: string;
  provider?: string;
  href?: string | null;
  direction?: "inbound" | "outbound" | "unknown";
  currency?: string | null;
  totalMinor?: number | null;
  amountDueMinor?: number | null;
  amountPaidMinor?: number | null;
  amountMinor?: number | null;
  amountRefundedMinor?: number | null;
  sources: ContextSource[];
};
export type BusinessContextSnapshot = {
  version: typeof BUSINESS_CONTEXT_VERSION;
  scope: { partnerId: string; clientId: string };
  revision: string;
  generatedAt: string;
  profile: BusinessProfile;
  facts: ContextFact[];
  records: ContextRecord[];
  coverage: ContextCoverage[];
  recommendations: ContextRecommendation[];
  observations: ContextObservation[];
  authority: BusinessAuthority;
  canWrite: boolean;
};
export type BusinessContextCommand =
  | { action: "review_context"; key: string; expectedContextRevision: string }
  | { action: "set_authority"; key: string; expectedRevision: number; channel: AuthorityChannel; mode: AuthorityMode }
  | { action: "manager_control"; key: string; expectedRevision: number; command: string };
export type BusinessCommandResult = {
  id: string;
  revision: number;
  message: string;
  cancelledWork: number;
  replayed: boolean;
};
