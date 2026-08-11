import type { ConnectorManifest } from "./types.ts";

const PLANNED_CONNECTORS: readonly (readonly [
  string,
  string,
  string,
  string,
])[] = [
  ["angi", "Angi", "marketplace", "Lead intake when partner API access is approved."],
  ["thumbtack", "Thumbtack", "marketplace", "Lead intake when partner API access is approved."],
  ["yelp", "Yelp", "marketplace", "Lead intake when reseller API access is approved."],
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
    key: "ringcentral", name: "RingCentral", category: "phone",
    description: "Live call signals, SMS events, and call history from RingCentral.", authStrategy: "oauth2",
    capabilities: ["lead.read", "lead.webhook", "message.webhook"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.ringcentral.com/guide", webhookEvents: ["call.ringing", "call.completed", "message.received"],
  },
  {
    key: "dialpad", name: "Dialpad", category: "phone",
    description: "Live call and SMS events plus call history from Dialpad.", authStrategy: "oauth2",
    capabilities: ["lead.read", "lead.webhook", "message.webhook"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.dialpad.com/docs", webhookEvents: ["call.ringing", "call.completed", "message.received"],
  },
  {
    key: "openphone", name: "Quo / OpenPhone", category: "phone",
    description: "Call, message, transcript, and summary events from Quo.", authStrategy: "api_key",
    capabilities: ["lead.read", "lead.webhook", "message.webhook"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://www.quo.com/docs/mdx/api-reference", webhookEvents: ["call.ringing", "call.completed", "call.summary.completed", "call.transcript.completed", "message.received"],
  },
  {
    key: "meta", name: "Facebook and Instagram", category: "lead_source",
    description: "Lead Ads, campaign performance, and attribution from Meta.", authStrategy: "oauth2",
    capabilities: ["lead.read", "lead.webhook", "campaign.read"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads", webhookEvents: ["leadgen"],
  },
  {
    key: "google_ads", name: "Google Ads and Local Services", category: "lead_source",
    description: "Lead forms, campaign performance, spend, calls, and conversion outcomes from Google Ads.", authStrategy: "oauth2",
    capabilities: ["lead.read", "campaign.read"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.google.com/google-ads/api/docs/start",
  },
  {
    key: "google_business_profile", name: "Google Business Profile", category: "reputation",
    description: "Locations, customer reviews, ratings, and approved replies.", authStrategy: "oauth2",
    capabilities: ["review.read", "review.update"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developers.google.com/my-business/reference/rest",
  },
  {
    key: "universal_lead_email", name: "Forwarded Lead Inbox", category: "lead_source",
    description: "Private inbound address that parses forwarded marketplace and form leads.", authStrategy: "managed",
    capabilities: ["lead.webhook"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://resend.com/docs/dashboard/receiving/introduction", webhookEvents: ["email.received"],
  },
  {
    key: "podium", name: "Podium", category: "reputation", description: "Customer reviews and approval-gated responses from Podium.", authStrategy: "oauth2",
    capabilities: ["review.read", "review.update"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://docs.podium.com/reference",
  },
  {
    key: "birdeye", name: "Birdeye", category: "reputation", description: "Aggregated customer reviews and ratings from Birdeye.", authStrategy: "api_key",
    capabilities: ["review.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developers.birdeye.com/",
  },
  {
    key: "jobber", name: "Jobber", category: "field_service",
    description: "Clients and jobs for Jobber businesses.", authStrategy: "oauth2",
    capabilities: ["customer.read", "customer.create", "job.read"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developer.getjobber.com/docs/",
  },
  {
    key: "housecall_pro", name: "Housecall Pro", category: "field_service",
    description: "Customers and jobs for Housecall Pro businesses.", authStrategy: "api_key",
    capabilities: ["customer.read", "customer.create", "job.read"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://docs.housecallpro.com/",
  },
  {
    key: "servicetitan", name: "ServiceTitan", category: "field_service",
    description: "Customers, jobs, appointments, and lead intake for ServiceTitan.", authStrategy: "api_key",
    capabilities: ["customer.read", "job.read", "appointment.read", "lead.create"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developer.servicetitan.io/docs/",
  },
  {
    key: "workiz", name: "Workiz", category: "field_service",
    description: "Leads and jobs for Workiz businesses.", authStrategy: "api_key",
    capabilities: ["lead.read", "lead.create", "job.read"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developer.workiz.com/",
  },
  {
    key: "quickbooks_online", name: "QuickBooks Online", category: "accounting",
    description: "Customers, invoices, payments, and payment status from QuickBooks Online.", authStrategy: "oauth2",
    capabilities: ["customer.read", "customer.create", "invoice.read", "payment.read"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developer.intuit.com/app/developer/qbo/docs/learn/explore-the-quickbooks-online-api",
  },
  {
    key: "stripe", name: "Stripe", category: "payments",
    description: "Customers, invoices, payment status, and hosted payment links from Stripe.", authStrategy: "api_key",
    capabilities: ["customer.read", "customer.create", "invoice.read", "payment.read", "payment.create"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://docs.stripe.com/api",
  },
  {
    key: "square", name: "Square", category: "payments",
    description: "Customers, invoices, payment status, and hosted payment links from Square.", authStrategy: "oauth2",
    capabilities: ["customer.read", "customer.create", "invoice.read", "payment.read", "payment.create"],
    verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://developer.squareup.com/reference/square",
  },
  {
    key: "callrail", name: "CallRail", category: "call_tracking",
    description: "Attributed phone calls and tracked form leads from CallRail.", authStrategy: "api_key",
    capabilities: ["lead.read"], verificationStatus: "contract_verified", requestable: false,
    docsUrl: "https://apidocs.callrail.com/", webhookEvents: ["pre_call", "post_call", "form_submission", "text_message"],
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
    capabilities: [
      "customer.read", "customer.create",
      "appointment.read", "appointment.create", "appointment.update", "appointment.delete",
      "message.read", "message.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://developers.google.com/workspace",
  },
  {
    key: "microsoft_365",
    name: "Microsoft 365",
    category: "productivity",
    description: "Outlook mail, calendar, and contacts through Microsoft Graph.",
    authStrategy: "oauth2",
    capabilities: [
      "customer.read", "customer.create", "customer.update", "customer.delete",
      "appointment.read", "appointment.create", "appointment.update", "appointment.delete",
      "message.read", "message.create",
    ],
    verificationStatus: "contract_verified",
    requestable: false,
    docsUrl: "https://learn.microsoft.com/graph/overview",
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
