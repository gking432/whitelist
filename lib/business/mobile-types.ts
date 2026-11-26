import type {
  BusinessConnection,
  BusinessEvent,
  BusinessRecord,
} from "./types";
import type { ConnectedData } from "../connections/types";

export type MobileCustomerApproval = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  editable_content: string | null;
  proposed_payload: Record<string, unknown> | null;
  created_at: string;
  resolved_at: string | null;
  action_jobs: {
    status: string;
    outcome_detail: string | null;
    created_at: string;
  }[];
};

export type MobileBusinessData = {
  connectedData?: ConnectedData;
  connectedDataError?: string | null;
  agentAttention: {
    id: string;
    kind?: string;
    title: string;
    status: string;
    summary: string;
    result_record_id: string | null;
    conversation_id?: string | null;
  }[];
  agentAttentionCount: number;
  currency: string;
  pendingRecords: BusinessRecord[];
  pendingBusinessCount: number;
  pendingCustomerCount: number;
  customerApprovals: MobileCustomerApproval[];
  recentCustomerApprovals: MobileCustomerApproval[];
  connections: BusinessConnection[];
  events: BusinessEvent[];
  canDecideBusiness: boolean;
  canDecideCustomer: boolean;
  canManageConnections: boolean;
  error: string | null;
};
