export const WORKSPACE_MODULES = ["messages", "appointments", "todo", "money"] as const;
export type WorkspaceModule = (typeof WORKSPACE_MODULES)[number];
export const WORKSPACE_MODULE_LABELS: Record<WorkspaceModule, string> = {
  messages: "Messages", appointments: "Appointments", todo: "To-do", money: "Money",
};
export type WorkspacePreferences = {
  revision: number;
  displayName: string | null;
  order: WorkspaceModule[];
  pinned: WorkspaceModule[];
};
export type WorkspaceActivity = { module: WorkspaceModule; days: number };
export type WorkspacePersonalization = {
  preferences: WorkspacePreferences;
  activity: WorkspaceActivity[];
  available: boolean;
  canEdit: boolean;
};
