import type { ClientRole } from "@/lib/permissions/types";

export const CLIENT_SECTION_KEYS = [
  "overview",
  "inbox",
  "contacts",
  "calls",
  "pipeline",
  "tasks",
  "schedule",
  "quotes",
  "marketing",
  "automations",
  "reports",
  "crm-sync",
  "settings",
  "action-center",
  "assistant",
  "approvals",
  "activity",
] as const;

export type ClientSectionKey = (typeof CLIENT_SECTION_KEYS)[number];

export const CLIENT_JOB_ROLES = [
  "owner",
  "manager",
  "sales",
  "front_desk",
  "marketing",
  "staff",
  "viewer",
] as const;

export type ClientJobRole = (typeof CLIENT_JOB_ROLES)[number];

export type ClientPermissionSet = {
  visibleSections: ClientSectionKey[];
  canViewActionCenter: boolean;
  canManageClientTeam: boolean;
  canResolveApprovals: boolean;
  canOperateCustomerActions: boolean;
  canEditCrmData: boolean;
};

export type StoredClientPermissions = {
  sections?: unknown;
  view_action_center?: unknown;
  resolve_approvals?: unknown;
  operate_customer_actions?: unknown;
  edit_crm_data?: unknown;
};

export const CLIENT_SECTION_LABELS: Record<ClientSectionKey, string> = {
  overview: "Overview",
  inbox: "Inbox",
  contacts: "Leads and customers",
  calls: "Calls",
  pipeline: "Pipeline",
  tasks: "Tasks",
  schedule: "Appointments",
  quotes: "Quote tool",
  marketing: "Marketing",
  automations: "AI automations",
  reports: "Reports",
  "crm-sync": "CRM sync",
  settings: "Settings",
  "action-center": "Action Center",
  assistant: "Assistant",
  approvals: "Approvals",
  activity: "Activity",
};

const ALL_SECTIONS = [...CLIENT_SECTION_KEYS];

const TEMPLATE_SECTIONS: Record<ClientJobRole, ClientSectionKey[]> = {
  owner: ALL_SECTIONS,
  manager: ALL_SECTIONS,
  sales: [
    "overview",
    "inbox",
    "contacts",
    "calls",
    "pipeline",
    "tasks",
    "schedule",
    "quotes",
    "assistant",
  ],
  front_desk: [
    "overview",
    "inbox",
    "contacts",
    "calls",
    "tasks",
    "schedule",
    "assistant",
  ],
  marketing: ["overview", "inbox", "marketing", "reports"],
  staff: ["overview", "inbox", "contacts", "tasks", "schedule"],
  viewer: ["overview"],
};

function defaultJobRole(role: ClientRole): ClientJobRole {
  if (role === "client_owner") return "owner";
  if (role === "client_manager") return "manager";
  if (role === "client_viewer") return "viewer";
  return "staff";
}

export function normalizeClientJobRole(
  role: ClientRole,
  value?: string | null,
): ClientJobRole {
  if (role === "client_owner") return "owner";
  if (CLIENT_JOB_ROLES.includes(value as ClientJobRole)) {
    return value as ClientJobRole;
  }
  return defaultJobRole(role);
}

export function membershipRoleForJobRole(jobRole: ClientJobRole): ClientRole {
  if (jobRole === "owner") return "client_owner";
  if (jobRole === "manager") return "client_manager";
  if (jobRole === "viewer") return "client_viewer";
  return "client_staff";
}

export function permissionsForJobRole(
  jobRole: ClientJobRole,
): ClientPermissionSet {
  const manager = jobRole === "owner" || jobRole === "manager";
  const operational = ["owner", "manager", "sales", "front_desk"].includes(
    jobRole,
  );

  return {
    visibleSections: [...TEMPLATE_SECTIONS[jobRole]],
    canViewActionCenter: manager,
    canManageClientTeam: jobRole === "owner",
    canResolveApprovals: manager,
    canOperateCustomerActions: operational,
    canEditCrmData: operational,
  };
}

function storedBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function resolveClientPermissions(input: {
  role: ClientRole;
  jobRole?: string | null;
  stored?: StoredClientPermissions | null;
}): ClientPermissionSet & { jobRole: ClientJobRole } {
  const jobRole = normalizeClientJobRole(input.role, input.jobRole);
  const defaults = permissionsForJobRole(jobRole);

  if (input.role === "client_owner") {
    return { ...permissionsForJobRole("owner"), jobRole: "owner" };
  }

  const storedSections = Array.isArray(input.stored?.sections)
    ? input.stored.sections.filter(
        (section): section is ClientSectionKey =>
          CLIENT_SECTION_KEYS.includes(section as ClientSectionKey),
      )
    : defaults.visibleSections;
  const visibleSections = [...new Set(storedSections)];
  const canViewActionCenter = storedBoolean(
    input.stored?.view_action_center,
    defaults.canViewActionCenter,
  );

  if (
    canViewActionCenter &&
    !visibleSections.includes("action-center")
  ) {
    visibleSections.push("action-center");
  }

  return {
    jobRole,
    visibleSections,
    canViewActionCenter,
    canManageClientTeam: false,
    canResolveApprovals: storedBoolean(
      input.stored?.resolve_approvals,
      defaults.canResolveApprovals,
    ),
    canOperateCustomerActions: storedBoolean(
      input.stored?.operate_customer_actions,
      defaults.canOperateCustomerActions,
    ),
    canEditCrmData: storedBoolean(
      input.stored?.edit_crm_data,
      defaults.canEditCrmData,
    ),
  };
}

export function clientCanAccessSection(
  sections: readonly ClientSectionKey[],
  section: ClientSectionKey,
): boolean {
  return sections.includes(section);
}

export function clientHomePath(
  sections: readonly ClientSectionKey[],
  experienceMode: "background_only" | "northstar_crm",
): string {
  if (experienceMode === "northstar_crm") {
    const firstCrmSection = CLIENT_SECTION_KEYS.find(
      (section) =>
        !["action-center", "assistant", "approvals", "activity"].includes(
          section,
        ) && sections.includes(section),
    );

    if (firstCrmSection) {
      return `/client/crm?view=${firstCrmSection}`;
    }
  }

  if (sections.includes("action-center")) return "/client/action-center";
  if (sections.includes("assistant")) return "/client/assistant";
  if (sections.includes("approvals")) return "/client/approvals";
  if (sections.includes("activity")) return "/client/activity";
  return "/client/crm";
}
