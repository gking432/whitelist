// Lead source setup catalog (docs/12 "Lead Source Setup Options").
// Pure product logic, versioned in code: the plain-language questions a
// partner answers, the setup paths Northstar supports, and honest
// availability. UI and the recommendation engine both read from here, so
// adding a provider path later is a catalog edit, not a UI rewrite.

export const LEAD_SOURCE_KEYS = [
  "website_forms",
  "website_chat",
  "phone_calls",
  "google_business_profile",
  "paid_ads",
  "email",
  "sms",
  "manual_entry",
] as const;

export type LeadSourceKey = (typeof LEAD_SOURCE_KEYS)[number];

export const WEBSITE_PLATFORM_KEYS = [
  "wordpress",
  "wix",
  "squarespace",
  "webflow",
  "shopify",
  "custom",
  "none",
  "unknown",
] as const;

export type WebsitePlatformKey = (typeof WEBSITE_PLATFORM_KEYS)[number];

export const SETUP_PATH_KEYS = [
  "native_connection",
  "platform_plugin",
  "automation_bridge",
  "hosted_page",
  "website_snippet",
  "generic_webhook",
  "manual_entry",
] as const;

export type SetupPathKey = (typeof SETUP_PATH_KEYS)[number];

export type SetupPathStatus = "available_now" | "coming_soon";

export type YesNoUnsure = "yes" | "no" | "unsure";

export type IntakeAnswers = {
  leadSources: LeadSourceKey[];
  websitePlatform: WebsitePlatformKey;
  canEditWebsite: YesNoUnsure;
  hasCrm: YesNoUnsure;
  hasPhoneProvider: YesNoUnsure;
  hasMessagingProvider: YesNoUnsure; // SMS/email sending
  hasCalendar: YesNoUnsure;
};

export const emptyIntakeAnswers: IntakeAnswers = {
  leadSources: [],
  websitePlatform: "unknown",
  canEditWebsite: "unsure",
  hasCrm: "unsure",
  hasPhoneProvider: "unsure",
  hasMessagingProvider: "unsure",
  hasCalendar: "unsure",
};

export const leadSourceLabels: Record<
  LeadSourceKey,
  { label: string; description: string }
> = {
  website_forms: {
    label: "Website forms",
    description: "Contact or quote forms on the client's website.",
  },
  website_chat: {
    label: "Website chat",
    description: "A chat assistant on the website that talks to visitors.",
  },
  phone_calls: {
    label: "Phone calls",
    description: "Inbound calls, including missed and after-hours calls.",
  },
  google_business_profile: {
    label: "Google Business Profile",
    description: "Calls, messages, and bookings from their Google listing.",
  },
  paid_ads: {
    label: "Paid ads & social",
    description: "Lead forms from Google, Facebook, or other ad platforms.",
  },
  email: {
    label: "Email",
    description: "Leads that arrive in an inbox like info@ or quotes@.",
  },
  sms: {
    label: "Text messages",
    description: "Customers who text the business number.",
  },
  manual_entry: {
    label: "Manual entry",
    description: "Leads written down from referrals, walk-ins, or yard signs.",
  },
};

export const websitePlatformLabels: Record<WebsitePlatformKey, string> = {
  wordpress: "WordPress",
  wix: "Wix",
  squarespace: "Squarespace",
  webflow: "Webflow",
  shopify: "Shopify",
  custom: "Custom-built site",
  none: "No website",
  unknown: "Not sure",
};

export const setupPathInfo: Record<
  SetupPathKey,
  {
    label: string;
    plainDescription: string;
    status: SetupPathStatus;
    requiresWebsiteAccess: boolean;
    // How the partner actually does it today (or what to expect if coming soon).
    howItWorksToday: string;
  }
> = {
  native_connection: {
    label: "One-click connection",
    plainDescription:
      "Sign in to the provider and Northstar connects directly.",
    status: "coming_soon",
    requiresWebsiteAccess: false,
    howItWorksToday:
      "Northstar has direct setup for its supported phone, messaging, calendar, CRM, advertising, and lead-inbox providers. Restricted marketplaces and unlisted systems use forwarded email, a bridge, or a webhook.",
  },
  platform_plugin: {
    label: "Website app / plugin",
    plainDescription:
      "Install a Northstar app inside WordPress, Wix, or Shopify.",
    status: "coming_soon",
    requiresWebsiteAccess: true,
    howItWorksToday:
      "Platform plugins are planned. Until then, the same result comes from an automation bridge or a webhook from the site's form tool.",
  },
  automation_bridge: {
    label: "Zapier / Make / n8n bridge",
    plainDescription:
      "Use an automation tool the client may already have to forward leads to Northstar.",
    status: "available_now",
    requiresWebsiteAccess: false,
    howItWorksToday:
      "Create a webhook intake connection for this client, then point a Zapier/Make/n8n step at the generated endpoint with the one-time credential.",
  },
  hosted_page: {
    label: "Hosted Northstar page",
    plainDescription:
      "A ready-made form, chat, or booking page you link to — no website changes needed.",
    status: "coming_soon",
    requiresWebsiteAccess: false,
    howItWorksToday:
      "Hosted website chat is available now. Standalone hosted forms and booking pages are planned; existing forms can use the secure intake webhook today.",
  },
  website_snippet: {
    label: "Copy/paste website snippet",
    plainDescription:
      "Paste one small code snippet into the site to add forms or chat.",
    status: "coming_soon",
    requiresWebsiteAccess: true,
    howItWorksToday:
      "The AI chat iframe snippet is available now. Native platform-specific apps and plugins are planned.",
  },
  generic_webhook: {
    label: "Webhook / API",
    plainDescription:
      "The client's existing form or system sends leads straight to a Northstar address.",
    status: "available_now",
    requiresWebsiteAccess: false,
    howItWorksToday:
      "Create a webhook intake connection; Northstar generates a unique endpoint and credential, and events start workflows immediately.",
  },
  manual_entry: {
    label: "Manual entry",
    plainDescription:
      "Type leads in by hand when nothing can be connected yet.",
    status: "available_now",
    requiresWebsiteAccess: false,
    howItWorksToday:
      "Open the client's built-in CRM pipeline and use Add lead. The record immediately enters the same CRM and workflow system as connected leads.",
  },
};

// Ordered setup paths per lead source, easiest-preferred (docs/12 order),
// before availability/answers are applied.
export const sourcePathOrder: Record<LeadSourceKey, SetupPathKey[]> = {
  website_forms: [
    "platform_plugin",
    "automation_bridge",
    "website_snippet",
    "generic_webhook",
    "hosted_page",
    "manual_entry",
  ],
  website_chat: [
    "platform_plugin",
    "website_snippet",
    "hosted_page",
    "automation_bridge",
    "generic_webhook",
  ],
  phone_calls: [
    "native_connection",
    "automation_bridge",
    "generic_webhook",
    "manual_entry",
  ],
  google_business_profile: [
    "native_connection",
    "hosted_page",
    "automation_bridge",
    "manual_entry",
  ],
  paid_ads: [
    "native_connection",
    "automation_bridge",
    "generic_webhook",
    "manual_entry",
  ],
  email: [
    "native_connection",
    "automation_bridge",
    "generic_webhook",
    "manual_entry",
  ],
  sms: [
    "native_connection",
    "automation_bridge",
    "generic_webhook",
    "manual_entry",
  ],
  manual_entry: ["manual_entry", "generic_webhook"],
};

// Per-source plain-language framing shown above the path list.
export const sourceSetupNotes: Partial<Record<LeadSourceKey, string>> = {
  website_chat:
    "The Northstar AI chat assistant answers visitors, collects lead details, qualifies the request, and routes it — every conversation lands here as an intake event.",
  phone_calls:
    "Managed Twilio numbers support native AI answering, outbound AI callbacks, SMS, and the live scheduling assistant. Retained phone systems use their supported call events or a bridge for caller matching and post-call workflows.",
  google_business_profile:
    "Google listings work best with tracking numbers and booking/contact links plus supported Google connections — not website code.",
  manual_entry:
    "No connection required — this path keeps the client fully supported while other sources come online.",
};
