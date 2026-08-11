import type { ConnectorManifest } from "./types.ts";

const PLANNED_CONNECTORS: readonly (readonly [
  string,
  string,
  string,
  string,
])[] = [
  ["jobber", "Jobber", "field_service", "Customers, requests, jobs, visits, quotes, and invoices."],
  ["housecall_pro", "Housecall Pro", "field_service", "Customers, jobs, estimates, appointments, and notes."],
  ["servicetitan", "ServiceTitan", "field_service", "Enterprise home-service customers, jobs, appointments, and estimates."],
  ["workiz", "Workiz", "field_service", "Customers, jobs, schedules, calls, and notes."],
  ["quickbooks_online", "QuickBooks Online", "accounting", "Customers, estimates, invoices, payments, and payment status."],
  ["stripe", "Stripe", "payments", "Payment links, payment events, and customer payment status."],
  ["square", "Square", "payments", "Customers, invoices, payment links, and payment events."],
  ["callrail", "CallRail", "call_tracking", "Caller identity, attribution, forms, texts, and call events."],
  ["ringcentral", "RingCentral", "phone", "Call and message events for businesses retaining RingCentral."],
  ["dialpad", "Dialpad", "phone", "Call and message events for businesses retaining Dialpad."],
  ["openphone", "OpenPhone", "phone", "Call and message events for businesses retaining OpenPhone."],
  ["meta", "Facebook and Instagram", "lead_source", "Lead Ads, campaign attribution, and approved conversion feedback."],
  ["google_ads", "Google Ads and Local Services", "lead_source", "Google advertising leads and campaign attribution."],
  ["google_business_profile", "Google Business Profile", "reputation", "Business messages, reviews, replies, and profile activity."],
  ["podium", "Podium", "reputation", "Customer conversations, review requests, and review events."],
  ["birdeye", "Birdeye", "reputation", "Review requests, reviews, replies, and customer conversations."],
  ["angi", "Angi", "marketplace", "Lead intake when partner API access is approved."],
  ["thumbtack", "Thumbtack", "marketplace", "Lead intake when partner API access is approved."],
  ["yelp", "Yelp", "marketplace", "Lead intake when reseller API access is approved."],
  ["universal_lead_email", "Lead Email Inbox", "lead_source", "Parse forwarded lead notifications when no direct API is available."],
];

export const CONNECTOR_CATALOG: readonly ConnectorManifest[] = [
  {
    key: "twilio",
    name: "Twilio",
    category: "phone",
    description: "Native phone numbers, calls, text messages, and client subaccounts.",
    authStrategy: "managed",
    capabilities: [
      "customer.search",
      "message.create",
      "message.webhook",
      "note.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://www.twilio.com/docs/usage/api",
  },
  {
    key: "hubspot",
    name: "HubSpot",
    category: "crm",
    description: "Customer records and AI notes for businesses using HubSpot CRM.",
    authStrategy: "api_key",
    capabilities: [
      "customer.read",
      "customer.search",
      "customer.create",
      "customer.update",
      "note.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
  },
  {
    key: "gohighlevel",
    name: "GoHighLevel",
    category: "crm",
    description: "Customer records and AI notes for GoHighLevel locations.",
    authStrategy: "api_key",
    capabilities: [
      "customer.read",
      "customer.search",
      "customer.create",
      "customer.update",
      "note.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
  },
  {
    key: "google_workspace",
    name: "Google Workspace",
    category: "productivity",
    description: "Google Calendar, Gmail, and Google Contacts.",
    authStrategy: "oauth2",
    capabilities: [],
    verificationStatus: "planned",
    requestable: true,
  },
  {
    key: "microsoft_365",
    name: "Microsoft 365",
    category: "productivity",
    description: "Outlook mail, calendar, and contacts through Microsoft Graph.",
    authStrategy: "oauth2",
    capabilities: [],
    verificationStatus: "planned",
    requestable: true,
  },
  ...PLANNED_CONNECTORS.map(([key, name, category, description]) => ({
    key,
    name,
    category,
    description,
    authStrategy: key === "universal_lead_email" ? ("managed" as const) : ("oauth2" as const),
    capabilities: [],
    verificationStatus:
      ["angi", "thumbtack", "yelp"].includes(key)
        ? ("restricted" as const)
        : ("planned" as const),
    requestable: true,
  })),
] satisfies readonly ConnectorManifest[];

export function findConnectorManifest(key: string): ConnectorManifest | null {
  return CONNECTOR_CATALOG.find((connector) => connector.key === key) ?? null;
}
