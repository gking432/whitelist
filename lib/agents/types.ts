import type { AgentKey, WorkKind } from "./catalog.ts";
export type WorkStatus =
  | "queued"
  | "running"
  | "waiting_children"
  | "waiting_approval"
  | "waiting_external"
  | "completed"
  | "blocked"
  | "cancelled";
export type AgentScope = { partnerId: string; clientId: string };
export type TeamSettings = {
  client_id: string;
  partner_id: string;
  status: "active" | "paused";
  marketing_enabled: boolean;
  administration_enabled: boolean;
  conversations_enabled: boolean;
  scheduling_enabled: boolean;
  sales_enabled: boolean;
  operations_enabled: boolean;
  scheduled_reviews: boolean;
  lead_stale_hours: number;
  next_review_at: string;
  updated_at: string;
};
export type WorkItem = {
  id: string;
  partner_id: string;
  client_id: string;
  parent_id: string | null;
  conversation_id: string | null;
  kind: WorkKind;
  agent_key: AgentKey;
  title: string;
  status: WorkStatus;
  summary: string;
  input: Record<string, unknown>;
  result: Record<string, unknown>;
  source_lead_id: string | null;
  source_record_id: string | null;
  result_record_id: string | null;
  approval_id: string | null;
  claim_token: string | null;
  lease_until: string | null;
  attempts: number;
  revision: number;
  next_run_at: string;
  created_at: string;
  updated_at: string;
};
export type WorkEvent = {
  id: string;
  work_id: string;
  status: string;
  summary: string;
  created_at: string;
};
export type VisibleWork = Pick<
  WorkItem,
  | "id"
  | "parent_id"
  | "conversation_id"
  | "kind"
  | "agent_key"
  | "title"
  | "status"
  | "summary"
  | "source_lead_id"
  | "source_record_id"
  | "result_record_id"
  | "approval_id"
  | "revision"
  | "created_at"
  | "updated_at"
>;
export type TeamSnapshot = {
  settings: TeamSettings | null;
  work: VisibleWork[];
  events: WorkEvent[];
  aiConfigured: boolean;
  canWrite: boolean;
  hasMore: boolean;
};
