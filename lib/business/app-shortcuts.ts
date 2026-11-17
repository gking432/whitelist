import type { BusinessConnection } from "./types";

// Provider-owned destinations only. Never build a launch URL from credentials
// or arbitrary integration config. These open the provider's own sign-in.
const APP_URLS: Record<string, string> = {
  google_calendar: "https://calendar.google.com/",
  google_workspace: "https://mail.google.com/",
  microsoft_365: "https://outlook.office.com/",
  stripe: "https://dashboard.stripe.com/",
  square: "https://squareup.com/dashboard",
  hubspot: "https://app.hubspot.com/",
  meta: "https://business.facebook.com/",
  quickbooks_online: "https://qbo.intuit.com/",
  ringcentral: "https://app.ringcentral.com/",
};

export function appShortcut(connection: BusinessConnection): string | null {
  const key = connection.provider?.provider_key ?? "";
  return Object.hasOwn(APP_URLS, key) ? APP_URLS[key] : null;
}

export function connectionLabel(connection: BusinessConnection): string {
  if (connection.status !== "connected") {
    if (connection.status === "disabled") return "Disconnected";
    if (connection.status === "paused") return "Paused";
    if (
      connection.status === "needs_attention" ||
      connection.status === "failing"
    )
      return "Needs attention";
    return "Setup needed";
  }
  return connection.runtime_mode === "live" ? "Connected" : "Preview only";
}
