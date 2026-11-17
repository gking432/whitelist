/** Data-only connections never participate in CRM projection or automation. */
export function isWorkspaceViewOnly(config: Record<string, unknown>) {
  return config.workspace_view_only === true;
}
export function allowsConnectorWork(
  config: Record<string, unknown>,
  direction: string,
  objectType: string,
) {
  return (
    !isWorkspaceViewOnly(config) ||
    (direction === "pull" && ["message", "appointment", "invoice", "payment"].includes(objectType))
  );
}

/** A page continuation is not proof that the authoritative import completed. */
export function connectorCursorIsPartial(cursor: Record<string, unknown> | null): boolean {
  return !!cursor && ["pageToken", "nextLink", "after"].some((key) =>
    typeof cursor[key] === "string" && String(cursor[key]).length > 0);
}
