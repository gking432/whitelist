// Pilot stack definition (docs/13). The first real-world loop runs on one
// deliberately small stack: HubSpot (CRM), Twilio (SMS), Google Calendar
// (scheduling), plus the built-in web chat / webhook intake that already
// exists. This module is plain metadata — everything the setup screen shows
// a non-technical partner, in one place.

export const PILOT_PROVIDER_KEYS = [
  "hubspot",
  "gohighlevel",
  "twilio",
  "resend",
  "google_calendar",
  "google_workspace",
  "microsoft_365",
  "jobber",
  "housecall_pro",
  "servicetitan",
  "workiz",
  "quickbooks_online",
  "stripe",
  "square",
  "callrail",
] as const;

export type PilotProviderKey = (typeof PILOT_PROVIDER_KEYS)[number];

export type PilotCredentialField = {
  name: string;
  label: string;
  placeholder: string;
  help: string;
  secret: boolean;
  optional?: boolean;
  options?: { value: string; label: string }[];
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
  gohighlevel: {
    key: "gohighlevel",
    title: "GoHighLevel CRM",
    tagline: "Keeps the client's contact list up to date automatically.",
    allows: [
      "Create a contact when a new lead comes in (or update the existing one).",
      "Attach an \"AI Assistant\" note to the contact describing what happened.",
      "Check that the connection is healthy.",
    ],
    neverDoes: [
      "Never deletes contacts, changes pipeline stages, or clears existing fields.",
      "Never messages anyone through GoHighLevel.",
    ],
    connectMethod: "credentials",
    fields: [
      {
        name: "privateToken",
        label: "Private integration token",
        placeholder: "pit-…",
        help: "In the sub-account: Settings → Private Integrations → create one with contacts read/write scopes.",
        secret: true,
      },
      {
        name: "locationId",
        label: "Location ID",
        placeholder: "e.g. ve9EPM428h8vShlRW1KT",
        help: "Settings → Business Profile → the sub-account's Location ID.",
        secret: false,
      },
    ],
    whereToGet:
      "GoHighLevel sub-account → Settings → Private Integrations → create a token with View/Edit Contacts scopes. The Location ID is under Settings → Business Profile. Connect either HubSpot or GoHighLevel — one CRM per client is enough.",
  },
  twilio: {
    key: "twilio",
    title: "Twilio Messaging + Voice",
    tagline:
      "Sends approved texts and connects the client's number to the branded phone assistant.",
    allows: [
      "Send an SMS to a lead after a human approves the exact message.",
      "Answer inbound calls with the client's AI phone assistant.",
      "Or ring a staff member while the assistant listens and opens the live desktop popup.",
      "Capture the transcript, contact details, scheduling request, CRM note, and follow-up work.",
      "Configure the Twilio number automatically after the credentials are verified.",
    ],
    neverDoes: [
      "Never sends anything without an approval.",
      "Never sends while the connection is in dry-run mode — it records what would have been sent instead.",
      "Never confirms a booking before an authorized person approves it.",
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
        label: "Twilio phone number",
        placeholder: "+15551234567",
        help: "A voice-and-SMS-capable Twilio number you own, in +1… format. Trial accounts can only contact verified numbers.",
        secret: false,
      },
      {
        name: "phoneHandlingMode",
        label: "Who answers incoming calls?",
        placeholder: "",
        help: "AI answering handles the entire call. Staff assist rings a person and opens the branded live popup.",
        secret: false,
        options: [
          { value: "ai_answered", label: "AI answers" },
          { value: "staff_assisted", label: "A staff member answers" },
        ],
      },
      {
        name: "staffForwardNumber",
        label: "Staff phone number (staff assist only)",
        placeholder: "+15557654321",
        help: "The phone assistant forwards incoming calls here while it transcribes and assists. Leave blank for AI answering.",
        secret: false,
        optional: true,
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
    tagline: "Lets the scheduling assistant see availability and book jobs on the calendar.",
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
  google_workspace: {
    key: "google_workspace",
    title: "Google Workspace",
    tagline: "Connects Gmail, Google Calendar, and Google Contacts with one sign-in.",
    allows: [
      "Sync contacts with the CRM and create new contacts from leads.",
      "Read availability and create or update approved appointments.",
      "Read inbox metadata and send approved email through the business account.",
    ],
    neverDoes: [
      "Never sends customer email without an approved workflow or user action.",
      "Never exposes Google credentials to the service partner.",
    ],
    connectMethod: "oauth",
    fields: [],
    whereToGet: "Sign in with the Google account the business already uses. No API key is required.",
  },
  microsoft_365: {
    key: "microsoft_365",
    title: "Microsoft 365",
    tagline: "Connects Outlook Mail, Calendar, and Contacts with one sign-in.",
    allows: [
      "Sync Outlook contacts with the CRM and create new contacts from leads.",
      "Read availability and create or update approved appointments.",
      "Read inbox metadata and send approved email through the business account.",
    ],
    neverDoes: [
      "Never sends customer email without an approved workflow or user action.",
      "Never exposes Microsoft credentials to the service partner.",
    ],
    connectMethod: "oauth",
    fields: [],
    whereToGet: "Sign in with the Microsoft account the business already uses. No API key is required.",
  },
  jobber: {
    key: "jobber", title: "Jobber", tagline: "Syncs clients and jobs with the field-service system the business already uses.",
    allows: ["Read clients and jobs for CRM context.", "Create a Jobber client when an approved lead is pushed."],
    neverDoes: ["Never changes job status or deletes Jobber records.", "Never exposes Jobber access to the service partner."],
    connectMethod: "oauth", fields: [],
    whereToGet: "Sign in with a Jobber administrator account. No API key is required.",
  },
  housecall_pro: {
    key: "housecall_pro", title: "Housecall Pro", tagline: "Syncs customers and jobs with Housecall Pro.",
    allows: ["Read customers and jobs for CRM context.", "Create a customer when an approved lead is pushed."],
    neverDoes: ["Never deletes customers or changes job status."], connectMethod: "credentials",
    fields: [{ name: "apiKey", label: "Housecall Pro API key", placeholder: "Paste API key", help: "Housecall Pro → My Apps → All Apps → API Key Management. Requires a MAX plan.", secret: true }],
    whereToGet: "Housecall Pro → My Apps → All Apps → API Key Management → Generate API Key. Choose only the permissions this integration needs.",
  },
  servicetitan: {
    key: "servicetitan", title: "ServiceTitan", tagline: "Syncs customers, jobs, appointments, and new leads with ServiceTitan.",
    allows: ["Read customers, jobs, and appointments.", "Create an approved lead in ServiceTitan."],
    neverDoes: ["Never changes job status, invoices, or payroll."], connectMethod: "credentials",
    fields: [
      { name: "clientId", label: "Client ID", placeholder: "ServiceTitan client ID", help: "Generated by the ServiceTitan tenant administrator.", secret: false },
      { name: "clientSecret", label: "Client secret", placeholder: "Client secret", help: "Generated with the client ID.", secret: true },
      { name: "appKey", label: "Application key", placeholder: "ak1...", help: "From the ServiceTitan Developer Portal app.", secret: true },
      { name: "tenantId", label: "Tenant ID", placeholder: "123456", help: "The ServiceTitan business tenant ID.", secret: false },
      { name: "environment", label: "Environment", placeholder: "", help: "Use production for a client account and integration for vendor testing.", secret: false, options: [{ value: "production", label: "Production" }, { value: "integration", label: "Integration test" }] },
    ],
    whereToGet: "ServiceTitan administrator → Settings → Integrations → API Application Access. The platform app must first be approved and visible to the tenant.",
  },
  workiz: {
    key: "workiz", title: "Workiz", tagline: "Syncs leads and jobs with Workiz.",
    allows: ["Read leads and jobs for CRM context.", "Create a Workiz lead from approved intake."],
    neverDoes: ["Never deletes leads or changes job status."], connectMethod: "credentials",
    fields: [{ name: "apiToken", label: "Workiz API token", placeholder: "Paste API token", help: "Generate the token in the Workiz account's developer/API settings.", secret: true }],
    whereToGet: "Open the Workiz account's developer/API settings and generate an API token for the business.",
  },
  quickbooks_online: {
    key: "quickbooks_online", title: "QuickBooks Online", tagline: "Keeps customers, invoices, and payment status in sync with QuickBooks.",
    allows: ["Read customers, invoices, and payments for reporting.", "Create a QuickBooks customer from an approved CRM record."],
    neverDoes: ["Never moves money or changes bank data.", "Never deletes accounting records."],
    connectMethod: "oauth", fields: [],
    whereToGet: "Sign in with the administrator of the client's QuickBooks Online company. No API key is required.",
  },
  stripe: {
    key: "stripe", title: "Stripe", tagline: "Syncs customers, invoices, payments, and approved payment links.",
    allows: ["Read customers, invoices, and payment status.", "Create an approved customer or hosted payment link."],
    neverDoes: ["Never refunds, transfers, or moves money.", "Never stores card numbers."],
    connectMethod: "credentials",
    fields: [{ name: "apiKey", label: "Restricted API key", placeholder: "rk_live_... or rk_test_...", help: "Stripe Dashboard → Developers → API keys → Create restricted key. Grant read access to Customers, Invoices, and Payment Intents; write access to Customers and Payment Links.", secret: true }],
    whereToGet: "Stripe Dashboard → Developers → API keys → Create restricted key. Use a test key first; switch to a live restricted key only after validation.",
  },
  square: {
    key: "square", title: "Square", tagline: "Syncs customers, invoices, payments, and approved payment links.",
    allows: ["Read customers, invoices, and payment status.", "Create an approved customer or hosted checkout link."],
    neverDoes: ["Never refunds or moves settled funds.", "Never stores card numbers."],
    connectMethod: "oauth", fields: [],
    whereToGet: "Sign in with the administrator of the client's Square seller account. No API key is required.",
  },
  callrail: {
    key: "callrail", title: "CallRail", tagline: "Brings tracked calls and website forms into lead intake with attribution.",
    allows: ["Read calls and form submissions as attributed leads.", "Preserve campaign, source, answer status, and call duration."],
    neverDoes: ["Never changes tracking numbers or call routing.", "Never publishes recordings outside the client's account."],
    connectMethod: "credentials",
    fields: [
      { name: "apiKey", label: "API v3 key", placeholder: "Paste CallRail API key", help: "CallRail → Integrations → Data access → API Keys → Create New API v3 Key.", secret: true },
      { name: "accountId", label: "Account ID", placeholder: "ACC...", help: "Open the CallRail dashboard and copy the account ID shown after /a/ in the URL.", secret: false },
    ],
    whereToGet: "CallRail → Integrations → Data access → API Keys. The key is only fully visible for 15 minutes; enter it directly here.",
  },
};

export function isPilotProviderKey(value: string): value is PilotProviderKey {
  return (PILOT_PROVIDER_KEYS as readonly string[]).includes(value);
}
