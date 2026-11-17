import { getGoogleOAuthClient, getMicrosoftOAuthClient, getSecretsEncryptionKey } from "../env.ts";
import type { ConnectionProviderOption } from "./types.ts";

export function ownerProviderOptions(configuration: {
  google: boolean; microsoft: boolean; secureStorage: boolean;
}): ConnectionProviderOption[] {
  const ready = configuration.secureStorage;
  return [
    { key: "google_workspace", label: "Gmail & Google Calendar", category: "mail_calendar", setup: "oauth",
      available: ready && configuration.google,
      detail: ready && configuration.google ? "Authorize read-only email and calendar access. Importing never activates assistants."
        : "Your operator needs to finish Google connection setup.",
      capabilities: ["message.read", "appointment.read"] },
    { key: "microsoft_365", label: "Outlook & Microsoft Calendar", category: "mail_calendar", setup: "oauth",
      available: ready && configuration.microsoft,
      detail: ready && configuration.microsoft ? "Authorize read-only Outlook inbox and calendar access. Sending stays off."
        : "Your operator needs to finish Microsoft connection setup.",
      capabilities: ["message.read", "appointment.read"] },
    { key: "stripe", label: "Stripe", category: "money", setup: "operator", available: ready,
      detail: ready ? "Operator-assisted read-only connection for invoices and payment status. A restricted Stripe read key is required; importing grants no payment actions."
        : "Your operator needs to finish secure connection setup before adding Stripe.",
      capabilities: ["invoice.read", "payment.read"] },
    { key: "generic_inbound_webhook", label: "Website intake form", category: "intake", setup: "token", available: ready,
      detail: ready ? "Create an intake endpoint for your website form. New submissions become shared leads; customer-facing actions keep their existing permissions."
        : "Your operator needs to finish secure connection setup before creating an intake endpoint.",
      capabilities: ["lead.webhook"] },
  ];
}

/** Public setup booleans only. No connection credentials are returned. */
export function readOwnerProviderOptions(): ConnectionProviderOption[] {
  const key = getSecretsEncryptionKey();
  return ownerProviderOptions({
    google: !!getGoogleOAuthClient(), microsoft: !!getMicrosoftOAuthClient(),
    secureStorage: !!key && Buffer.from(key, "base64").length === 32,
  });
}
