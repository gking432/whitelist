import type { AccessContext } from "../permissions/types.ts";
export function canReadBusinessWorkspace(access: AccessContext): boolean {
  if (access.isImpersonating)
    return Boolean(access.clientId && access.partnerId);
  if (!["client_owner", "client_manager"].includes(access.role)) return false;
  return [
    "settings",
    "marketing",
    "tasks",
    "contacts",
    "automations",
    "action-center",
  ].every((section) => access.visibleClientSections.some((s) => s === section));
}
export function canWriteBusinessWorkspace(access: AccessContext): boolean {
  return (
    canReadBusinessWorkspace(access) &&
    access.canEditClientData &&
    access.canOperateCustomerActions &&
    access.canResolveApprovals &&
    (!access.isImpersonating || access.impersonationMode === "sandbox_full")
  );
}
