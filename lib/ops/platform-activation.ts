import { productionReadiness, type ReadinessEnvironment } from "./production-readiness.ts";

export type ActivationItem = {
  key: string;
  label: string;
  purpose: string;
  configured: boolean;
  required: boolean;
  accountUrl?: string;
  callbackPaths?: string[];
  environmentKeys?: string[];
};

export type ActivationGroup = {
  key: string;
  label: string;
  items: ActivationItem[];
};

function value(env: ReadinessEnvironment, key: string) {
  return env[key]?.trim() ?? "";
}

function all(env: ReadinessEnvironment, keys: string[]) {
  return keys.every((key) => value(env, key).length > 0);
}

export function platformActivation(
  env: ReadinessEnvironment = process.env,
): {
  coreReady: boolean;
  coreComplete: number;
  coreTotal: number;
  groups: ActivationGroup[];
} {
  const readiness = productionReadiness(env);
  const groups: ActivationGroup[] = [
    {
      key: "infrastructure",
      label: "Hosting and data",
      items: [
        {
          key: "app",
          label: "Public application",
          purpose: "Stable HTTPS domain for sign-in, OAuth callbacks, webhooks, and desktop clients.",
          configured: !readiness.issues.some((issue) => issue.key === "APP_URL"),
          required: true,
          environmentKeys: ["APP_URL"],
        },
        {
          key: "supabase",
          label: "Hosted Supabase",
          purpose: "Production database, authentication, tenant isolation, and backups.",
          configured:
            !readiness.issues.some((issue) =>
              [
                "NEXT_PUBLIC_SUPABASE_URL",
                "NEXT_PUBLIC_SUPABASE_ANON_KEY",
                "SUPABASE_SERVICE_ROLE_KEY",
              ].includes(issue.key),
            ),
          required: true,
          accountUrl: "https://supabase.com/dashboard",
          environmentKeys: [
            "NEXT_PUBLIC_SUPABASE_URL",
            "NEXT_PUBLIC_SUPABASE_ANON_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
          ],
        },
        {
          key: "encryption",
          label: "Credential encryption",
          purpose: "Encrypts every partner and client provider secret at rest.",
          configured: !readiness.issues.some(
            (issue) => issue.key === "SECRETS_ENCRYPTION_KEY",
          ),
          required: true,
          environmentKeys: ["SECRETS_ENCRYPTION_KEY"],
        },
        {
          key: "jobs",
          label: "Background jobs",
          purpose: "Retries failed work, delivers alerts, and runs retention cleanup.",
          configured: !readiness.issues.some(
            (issue) => issue.key === "CRON_SECRET",
          ),
          required: true,
          environmentKeys: ["CRON_SECRET"],
        },
        {
          key: "alerts",
          label: "Owner incident alerts",
          purpose: "Sends first-occurrence failures to the private owner channel.",
          configured: !readiness.issues.some(
            (issue) => issue.key === "PLATFORM_ALERT_WEBHOOK_URL",
          ),
          required: true,
          environmentKeys: ["PLATFORM_ALERT_WEBHOOK_URL"],
        },
        {
          key: "safety_flags",
          label: "Production safety flags",
          purpose: "Disables Scenario Lab, local preview login, and public-web Codex execution.",
          configured: !readiness.issues.some((issue) =>
            [
              "ENABLE_SCENARIO_LAB",
              "ENABLE_LOCAL_PREVIEW_LOGIN",
              "ENABLE_CODEX_CONNECTOR_WORKER",
            ].includes(issue.key),
          ),
          required: true,
          environmentKeys: [
            "ENABLE_SCENARIO_LAB",
            "ENABLE_LOCAL_PREVIEW_LOGIN",
            "ENABLE_CODEX_CONNECTOR_WORKER",
          ],
        },
      ],
    },
    {
      key: "ai_communications",
      label: "AI, voice, and email",
      items: [
        {
          key: "workflow_ai",
          label: "AI workflow engine",
          purpose: "Lead analysis, summaries, drafts, triage, and workflow decisions.",
          configured: !readiness.issues.some(
            (issue) => issue.key === "ANTHROPIC_API_KEY",
          ),
          required: true,
          accountUrl: "https://console.anthropic.com/settings/keys",
          environmentKeys: ["ANTHROPIC_API_KEY"],
        },
        {
          key: "voice_ai",
          label: "OpenAI Realtime",
          purpose: "AI phone answering, transcription, and live staff scheduling assistance.",
          configured:
            !readiness.issues.some((issue) =>
              ["OPENAI_API_KEY", "VOICE_PROVIDER"].includes(issue.key),
            ),
          required: true,
          accountUrl: "https://platform.openai.com/api-keys",
          environmentKeys: ["VOICE_PROVIDER", "OPENAI_API_KEY"],
        },
        {
          key: "voice_gateway",
          label: "Always-on voice gateway",
          purpose: "Streams real Twilio calls to transcription and the desktop assistant.",
          configured:
            !readiness.issues.some((issue) =>
              ["NORTHSTAR_VOICE_STREAM_URL", "VOICE_STREAM_SHARED_SECRET"].includes(
                issue.key,
              ),
            ),
          required: true,
          environmentKeys: [
            "NORTHSTAR_VOICE_STREAM_URL",
            "VOICE_STREAM_SHARED_SECRET",
          ],
        },
        {
          key: "resend",
          label: "Platform email and inbound leads",
          purpose: "Support alerts, customer email, and private forwarded-lead inboxes.",
          configured:
            !readiness.issues.some((issue) =>
              [
                "PLATFORM_RESEND_API_KEY",
                "PLATFORM_ALERT_FROM_EMAIL",
                "RESEND_WEBHOOK_SECRET",
                "RESEND_INBOUND_DOMAIN",
              ].includes(issue.key),
            ),
          required: true,
          accountUrl: "https://resend.com/domains",
          callbackPaths: ["/api/integrations/inbound/email/resend"],
          environmentKeys: [
            "PLATFORM_RESEND_API_KEY",
            "PLATFORM_ALERT_FROM_EMAIL",
            "RESEND_WEBHOOK_SECRET",
            "RESEND_INBOUND_DOMAIN",
          ],
        },
      ],
    },
    {
      key: "provider_apps",
      label: "Platform OAuth applications",
      items: [
        {
          key: "google",
          label: "Google Workspace and Calendar",
          purpose: "Lets clients connect Google contacts, calendars, mail, and Business Profile.",
          configured: all(env, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]),
          required: false,
          accountUrl: "https://console.cloud.google.com/apis/credentials",
          callbackPaths: [
            "/api/oauth/google/callback",
            "/api/oauth/google-workspace/callback",
            "/api/oauth/google_business_profile/callback",
          ],
          environmentKeys: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
        },
        {
          key: "google_ads",
          label: "Google Ads and Local Services",
          purpose: "Reads campaign, spend, lead, call, and conversion attribution.",
          configured:
            all(env, ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]) &&
            value(env, "GOOGLE_ADS_DEVELOPER_TOKEN").length > 0,
          required: false,
          accountUrl: "https://ads.google.com/aw/apicenter",
          callbackPaths: ["/api/oauth/google_ads/callback"],
          environmentKeys: [
            "GOOGLE_OAUTH_CLIENT_ID",
            "GOOGLE_OAUTH_CLIENT_SECRET",
            "GOOGLE_ADS_DEVELOPER_TOKEN",
          ],
        },
        {
          key: "microsoft",
          label: "Microsoft 365",
          purpose: "Lets clients connect Outlook contacts, calendar, and email.",
          configured: all(env, [
            "MICROSOFT_OAUTH_CLIENT_ID",
            "MICROSOFT_OAUTH_CLIENT_SECRET",
          ]),
          required: false,
          accountUrl: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
          callbackPaths: ["/api/oauth/microsoft/callback"],
          environmentKeys: [
            "MICROSOFT_OAUTH_CLIENT_ID",
            "MICROSOFT_OAUTH_CLIENT_SECRET",
          ],
        },
        {
          key: "jobber",
          label: "Jobber",
          purpose: "Lets Jobber businesses authorize customer and job sync.",
          configured: all(env, ["JOBBER_OAUTH_CLIENT_ID", "JOBBER_OAUTH_CLIENT_SECRET"]),
          required: false,
          accountUrl: "https://developer.getjobber.com/",
          callbackPaths: ["/api/oauth/jobber/callback"],
          environmentKeys: ["JOBBER_OAUTH_CLIENT_ID", "JOBBER_OAUTH_CLIENT_SECRET"],
        },
        {
          key: "quickbooks",
          label: "QuickBooks Online",
          purpose: "Lets clients authorize customer, invoice, and payment sync.",
          configured: all(env, [
            "QUICKBOOKS_OAUTH_CLIENT_ID",
            "QUICKBOOKS_OAUTH_CLIENT_SECRET",
          ]),
          required: false,
          accountUrl: "https://developer.intuit.com/app/developer/dashboard",
          callbackPaths: ["/api/oauth/quickbooks/callback"],
          environmentKeys: [
            "QUICKBOOKS_OAUTH_CLIENT_ID",
            "QUICKBOOKS_OAUTH_CLIENT_SECRET",
          ],
        },
        {
          key: "square",
          label: "Square",
          purpose: "Lets clients authorize customer and payment activity.",
          configured: all(env, ["SQUARE_OAUTH_CLIENT_ID", "SQUARE_OAUTH_CLIENT_SECRET"]),
          required: false,
          accountUrl: "https://developer.squareup.com/apps",
          callbackPaths: ["/api/oauth/square/callback"],
          environmentKeys: ["SQUARE_OAUTH_CLIENT_ID", "SQUARE_OAUTH_CLIENT_SECRET"],
        },
        {
          key: "ringcentral",
          label: "RingCentral",
          purpose: "Retains a client's current phone system for call and message events.",
          configured: all(env, [
            "RINGCENTRAL_OAUTH_CLIENT_ID",
            "RINGCENTRAL_OAUTH_CLIENT_SECRET",
          ]),
          required: false,
          accountUrl: "https://developers.ringcentral.com/console/my-credentials/create.html",
          callbackPaths: ["/api/oauth/ringcentral/callback"],
          environmentKeys: [
            "RINGCENTRAL_OAUTH_CLIENT_ID",
            "RINGCENTRAL_OAUTH_CLIENT_SECRET",
          ],
        },
        {
          key: "dialpad",
          label: "Dialpad",
          purpose: "Retains a client's Dialpad calls and SMS as assistant triggers.",
          configured: all(env, ["DIALPAD_OAUTH_CLIENT_ID", "DIALPAD_OAUTH_CLIENT_SECRET"]),
          required: false,
          accountUrl: "https://developers.dialpad.com/",
          callbackPaths: ["/api/oauth/dialpad/callback"],
          environmentKeys: ["DIALPAD_OAUTH_CLIENT_ID", "DIALPAD_OAUTH_CLIENT_SECRET"],
        },
        {
          key: "meta",
          label: "Facebook and Instagram",
          purpose: "Receives Lead Ads and reads campaign attribution.",
          configured: all(env, [
            "META_APP_ID",
            "META_APP_SECRET",
            "META_WEBHOOK_VERIFY_TOKEN",
          ]),
          required: false,
          accountUrl: "https://developers.facebook.com/apps/",
          callbackPaths: ["/api/oauth/meta/callback", "/api/integrations/inbound/meta"],
          environmentKeys: ["META_APP_ID", "META_APP_SECRET", "META_WEBHOOK_VERIFY_TOKEN"],
        },
        {
          key: "podium",
          label: "Podium",
          purpose: "Reads reviews and sends approved responses.",
          configured: all(env, ["PODIUM_OAUTH_CLIENT_ID", "PODIUM_OAUTH_CLIENT_SECRET"]),
          required: false,
          accountUrl: "https://developer.podium.com/",
          callbackPaths: ["/api/oauth/podium/callback"],
          environmentKeys: ["PODIUM_OAUTH_CLIENT_ID", "PODIUM_OAUTH_CLIENT_SECRET"],
        },
      ],
    },
  ];
  const coreItems = groups.flatMap((group) => group.items).filter((item) => item.required);
  const coreComplete = coreItems.filter((item) => item.configured).length;

  return {
    coreReady: readiness.ready,
    coreComplete,
    coreTotal: coreItems.length,
    groups,
  };
}
