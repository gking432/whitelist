// Pilot stack definition (docs/13). The first real-world loop runs on one
// deliberately small stack: HubSpot (CRM), Twilio (SMS), Google Calendar
// (scheduling), plus the built-in web chat / webhook intake that already
// exists. This module is plain metadata — everything the setup screen shows
// a non-technical partner, in one place.

export const PILOT_PROVIDER_KEYS = [
  "hubspot",
  "twilio",
  "resend",
  "google_calendar",
] as const;

export type PilotProviderKey = (typeof PILOT_PROVIDER_KEYS)[number];

export type PilotCredentialField = {
  name: string;
  label: string;
  placeholder: string;
  help: string;
  secret: boolean;
  optional?: boolean;
};

export type PilotProviderMeta = {
  key: PilotProviderKey;
  title: string;
  tagline: string;
  // Plain-language list of what a connection lets Northstar do — shown on
  // the setup card so partners know exactly what they are granting.
  allows: string[];
  // What Northstar will NOT do with this connection (honesty beats surprise).
  neverDoes: string[];
  connectMethod: "credentials" | "oauth";
  fields: PilotCredentialField[];
  whereToGet: string;
};

export const PILOT_PROVIDERS: Record<PilotProviderKey, PilotProviderMeta> = {
  hubspot: {
    key: "hubspot",
    title: "HubSpot CRM",
    tagline: "Keeps the client's contact list up to date automatically.",
    allows: [
      "Create a contact when a new lead comes in (or update the existing one).",
      "Attach an \"AI Assistant\" note to the contact describing what happened.",
      "Check that the connection is healthy.",
    ],
    neverDoes: [
      "Never deletes contacts, changes deal stages, or clears existing fields.",
      "Never emails anyone through HubSpot.",
    ],
    connectMethod: "credentials",
    fields: [
      {
        name: "privateAppToken",
        label: "Private app access token",
        placeholder: "pat-na1-…",
        help: "In HubSpot: Settings → Integrations → Private Apps → Create app. Give it the crm.objects.contacts read/write scopes.",
        secret: true,
      },
    ],
    whereToGet:
      "HubSpot → Settings (gear icon) → Integrations → Private Apps → Create a private app. Scopes needed: crm.objects.contacts (read + write). Copy the access token after creating.",
  },
  twilio: {
    key: "twilio",
    title: "Twilio SMS",
    tagline: "Sends the text messages you approve — nothing goes out on its own.",
    allows: [
      "Send an SMS to a lead after a human approves the exact message.",
      "Check that the account and phone number are valid.",
    ],
    neverDoes: [
      "Never sends anything without an approval.",
      "Never sends while the connection is in dry-run mode — it records what would have been sent instead.",
    ],
    connectMethod: "credentials",
    fields: [
      {
        name: "accountSid",
        label: "Account SID",
        placeholder: "AC…",
        help: "Shown on the Twilio Console home page.",
        secret: false,
      },
      {
        name: "authToken",
        label: "Auth token",
        placeholder: "••••••••",
        help: "Next to the Account SID on the Twilio Console home page.",
        secret: true,
      },
      {
        name: "fromNumber",
        label: "Sending phone number",
        placeholder: "+15551234567",
        help: "A Twilio number you own, in +1… format. Trial accounts can only text verified numbers.",
        secret: false,
      },
    ],
    whereToGet:
      "console.twilio.com → the Account SID and Auth Token are on the home dashboard. Buy (or use the trial) phone number under Phone Numbers → Manage → Active numbers.",
  },
  resend: {
    key: "resend",
    title: "Resend Email",
    tagline: "Sends the emails you approve — nothing goes out on its own.",
    allows: [
      "Send an email to a lead after a human approves the exact message.",
      "Check that the API key and sending domain are valid.",
    ],
    neverDoes: [
      "Never sends anything without an approval.",
      "Never sends while the connection is in dry-run mode — it records what would have been sent instead.",
    ],
    connectMethod: "credentials",
    fields: [
      {
        name: "apiKey",
        label: "Resend API key",
        placeholder: "re_…",
        help: "resend.com → API Keys → Create API key (Sending access is enough).",
        secret: true,
      },
      {
        name: "fromEmail",
        label: "From address",
        placeholder: "office@clientdomain.com",
        help: "The address customers see. Its domain should be verified in Resend.",
        secret: false,
      },
      {
        name: "fromName",
        label: "From name (optional)",
        placeholder: "Pilot Plumbing Co",
        help: "Shown as the sender name. Leave blank to send from the bare address.",
        secret: false,
        optional: true,
      },
    ],
    whereToGet:
      "resend.com (free tier works) → verify the client's sending domain under Domains → create an API key under API Keys. For a quick test you can use Resend's onboarding sender before the domain is verified.",
  },
  google_calendar: {
    key: "google_calendar",
    title: "Google Calendar",
    tagline: "Lets Northstar see availability and book jobs on the calendar.",
    allows: [
      "Read busy/free blocks on the connected Google account's primary calendar.",
      "Create calendar events for booked appointments (approval-gated, live mode only).",
    ],
    neverDoes: [
      "Never deletes or edits events it did not create.",
      "Never reads event contents beyond busy/free when checking availability.",
    ],
    connectMethod: "oauth",
    fields: [
      {
        name: "clientId",
        label: "OAuth client ID",
        placeholder: "…apps.googleusercontent.com",
        help: "From your Google Cloud project's OAuth credentials.",
        secret: false,
      },
      {
        name: "clientSecret",
        label: "OAuth client secret",
        placeholder: "GOCSPX-…",
        help: "Shown once when the OAuth client is created.",
        secret: true,
      },
    ],
    whereToGet:
      "console.cloud.google.com → create a project → enable the Google Calendar API → OAuth consent screen (External, add your test account) → Credentials → Create OAuth client ID (Web application) with the redirect URI shown on this card.",
  },
};

export function isPilotProviderKey(value: string): value is PilotProviderKey {
  return (PILOT_PROVIDER_KEYS as readonly string[]).includes(value);
}
