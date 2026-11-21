import { getHubSpotOAuthClient } from "../integrations/providers/hubspot-oauth.ts";
import { getGoogleOAuthClient, getMicrosoftOAuthClient, getSecretsEncryptionKey } from "../env.ts";
import type { ConnectionProviderOption } from "./types.ts";

export function ownerProviderOptions(configuration: {
  google: boolean; microsoft: boolean; secureStorage: boolean; hubspot?: boolean;
}): ConnectionProviderOption[] {
  const ready = configuration.secureStorage;
  return [
    { key: "hubspot", label: "HubSpot", category: "crm", setup: "oauth", available: ready && configuration.hubspot === true,
      createAccountUrl: "https://www.hubspot.com/products/get-started", signInUrl: "https://app.hubspot.com/login",
      detail: ready && configuration.hubspot ? "Connect your own HubSpot account. Import contacts, deals and notes first; separately grant and enable reviewed contact and note creation. Controlled contact/deal updates are a later acceptance target."
        : "Your operator needs to configure the HubSpot OAuth app. You can create or sign in to your own HubSpot account now.",
      capabilities: ["customer.read", "lead.read", "note.read"] },
    { key: "google_workspace", label: "Gmail & Google Calendar", category: "mail_calendar", setup: "oauth",
      available: ready && configuration.google,
      detail: ready && configuration.google ? "Connect read-only email and calendar first. You can separately authorize calendar changes or email sending for this same account; assistants and paused actions keep their own controls."
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
    hubspot: !!getHubSpotOAuthClient(), google: !!getGoogleOAuthClient(), microsoft: !!getMicrosoftOAuthClient(),
    secureStorage: !!key && Buffer.from(key, "base64").length === 32,
  });
}
