const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** An attempt-bound navigation hint, never identity, permission or a URL. */
export function onboardingReturnHintName(attemptId: unknown): string | null {
  return typeof attemptId === "string" && uuid.test(attemptId) ? `onboarding_return_${attemptId.toLowerCase()}` : null;
}
export function onboardingReturnHintForAuthCookie(name: string): string | null {
  const match = /^(?:workspace_read|workspace_permissions|hubspot_oauth)_([a-f0-9-]{36})$/i.exec(name);
  return match ? onboardingReturnHintName(match[1]) : null;
}
export function connectionCallbackPath(hint: unknown): "/client/onboarding" | "/client/apps" {
  return hint === "onboarding" ? "/client/onboarding" : "/client/apps";
}

/** Query strings supply feedback only. Fresh scoped data supplies app status. */
export function connectionOutcomeNotice(outcome: unknown): string | undefined {
  if (typeof outcome !== "string") return undefined;
  switch (outcome) {
    case "connected": case "permissions_updated":
      return "You’re back from app setup. Check the saved connection status below.";
    case "sync_pending":
      return "App setup returned, but the first update could not be started. Check the saved connection status below.";
    case "denied": case "permissions_denied":
      return "App access was not approved. You can try again or skip for now.";
    case "expired":
      return "That app setup attempt expired. Start again below or skip for now.";
    case "permissions": case "permissions_failed": case "permissions_changed": case "changed":
      return "App access changed during setup. Check the saved status before trying again.";
    case "failed": case "unavailable":
      return "App setup could not be confirmed. Check the saved status, try again or skip for now.";
    case "sign_in_required":
      return "Sign in with owner access before continuing app setup.";
    default: return undefined;
  }
}
