import type { BusinessSnapshot } from "./types.ts";

export type SavedTask = {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "done" | "cancelled";
  priority: string;
  due_at: string | null;
  updated_at: string;
};
export type TodoWork = {
  id: string;
  title: string;
  summary: string;
  status: string;
  agent_key: string;
  revision: number;
  updated_at: string;
  approval_id: string | null;
  conversation_id: string | null;
  result_record_id: string | null;
};
export type TodoSnapshot = {
  workspace: Pick<BusinessSnapshot, "records" | "profile" | "canWrite">;
  tasks: SavedTask[];
  work: TodoWork[];
  timeZone: string;
  generatedAt: string;
  limited: boolean;
  errors: string[];
};
