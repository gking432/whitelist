import {
  leadSourceLabels,
  setupPathInfo,
  sourcePathOrder,
  sourceSetupNotes,
  websitePlatformLabels,
  type IntakeAnswers,
  type LeadSourceKey,
  type SetupPathKey,
  type SetupPathStatus,
} from "./catalog.ts";

// Turns the partner's plain-language answers into a ranked setup plan per
// lead source. Pure function: UI previews it live and the server stores the
// same result. The first path that is available today becomes "recommended";
// provider-restricted and unfinished paths remain clearly labeled.

export type PathRecommendation = {
  path: SetupPathKey;
  label: string;
  plainDescription: string;
  howItWorksToday: string;
  status: SetupPathStatus;
  recommended: boolean;
  blockedReason: string | null;
  action: { label: string; hrefSuffix: string } | null;
};

export type SourceRecommendation = {
  source: LeadSourceKey;
  sourceLabel: string;
  note: string | null;
  paths: PathRecommendation[];
};

export type SetupPlan = {
  sources: SourceRecommendation[];
  stackNotes: string[];
};

// Where an "available now" path actually starts inside the product. Suffixes
// are appended to /partner/clients/{clientId}.
const pathActions: Partial<
  Record<SetupPathKey, { label: string; hrefSuffix: string }>
> = {
  native_connection: {
    label: "Add provider connection",
    hrefSuffix: "/integrations/new",
  },
  hosted_page: {
    label: "Set up website chat",
    hrefSuffix: "/integrations/new",
  },
  website_snippet: {
    label: "Set up website chat",
    hrefSuffix: "/integrations/new",
  },
  automation_bridge: {
    label: "Create webhook intake connection",
    hrefSuffix: "/integrations/new",
  },
  generic_webhook: {
    label: "Create webhook intake connection",
    hrefSuffix: "/integrations/new",
  },
  manual_entry: {
    label: "Add a lead",
    hrefSuffix: "/crm?view=pipeline&new=1",
  },
};

const LIVE_NATIVE_SOURCES = new Set<LeadSourceKey>([
  "phone_calls",
  "paid_ads",
  "email",
  "sms",
]);

function pathsForSource(
  source: LeadSourceKey,
  answers: IntakeAnswers,
): PathRecommendation[] {
  const ordered = sourcePathOrder[source];
  let recommendedAssigned = false;

  return ordered.map((path) => {
    const info = setupPathInfo[path];
    const isLiveWebsiteChatPath =
      source === "website_chat" &&
      (path === "hosted_page" || path === "website_snippet");
    const isLiveNativePath =
      path === "native_connection" && LIVE_NATIVE_SOURCES.has(source);
    const status =
      isLiveWebsiteChatPath || isLiveNativePath
        ? "available_now"
        : info.status;
    const howItWorksToday = isLiveWebsiteChatPath
      ? path === "hosted_page"
        ? "Create a Northstar Website Chat connection, enable its widget key, and share the generated hosted chat URL. Completed conversations enter the normal intake workflows."
        : "Create a Northstar Website Chat connection, enable its widget key, and paste the generated iframe snippet into the client's site."
      : isLiveNativePath
        ? source === "phone_calls"
          ? "Provision a managed Twilio number for native AI answering, callbacks, SMS, and live staff assistance. A retained RingCentral, Dialpad, or Quo number can send the call events its API exposes."
          : source === "paid_ads"
            ? "Connect Meta or Google Ads. Northstar imports supported lead and campaign data; marketplace leads without approved API access use the private forwarded lead inbox."
            : source === "email"
              ? "Connect Google Workspace or Microsoft 365, or use the client's private forwarded lead inbox. New messages enter the normal intake workflows."
              : "Add a Twilio SMS connection and point the Twilio inbound-message webhook at Northstar. Replies remain approval-gated and respect dry-run/live mode."
        : info.howItWorksToday;

    const blockedReason =
      info.requiresWebsiteAccess && answers.canEditWebsite === "no"
        ? "Needs website access, which this client doesn't have."
        : info.requiresWebsiteAccess &&
            (answers.websitePlatform === "none" ||
              answers.websitePlatform === "unknown")
          ? answers.websitePlatform === "none"
            ? "The client has no website."
            : "Confirm the website platform first."
          : null;

    const eligible = status === "available_now" && blockedReason === null;
    const recommended = eligible && !recommendedAssigned;

    if (recommended) {
      recommendedAssigned = true;
    }

    return {
      path,
      label: info.label,
      plainDescription: info.plainDescription,
      howItWorksToday,
      status,
      recommended,
      blockedReason,
      action: eligible ? (pathActions[path] ?? null) : null,
    };
  });
}

export function recommendSetupPlan(answers: IntakeAnswers): SetupPlan {
  const sources = answers.leadSources.map((source) => ({
    source,
    sourceLabel: leadSourceLabels[source].label,
    note: sourceSetupNotes[source] ?? null,
    paths: pathsForSource(source, answers),
  }));

  const stackNotes: string[] = [];
  const platformLabel = websitePlatformLabels[answers.websitePlatform];

  if (
    answers.websitePlatform !== "none" &&
    answers.websitePlatform !== "unknown"
  ) {
    stackNotes.push(
      answers.canEditWebsite === "yes"
        ? `${platformLabel} site with edit access — snippet and plugin paths will unlock as they ship; bridges and webhooks work today.`
        : `${platformLabel} site without confirmed edit access — prefer bridges, webhooks, and hosted pages so nothing on the site needs to change.`,
    );
  } else if (answers.websitePlatform === "none") {
    stackNotes.push(
      "No website: the hosted Northstar chat page works today; webhooks, manual intake, and automation bridges cover other lead sources.",
    );
  }

  if (answers.hasCrm === "yes") {
    stackNotes.push(
      "Client has a CRM — keep it as the system of record. HubSpot and GoHighLevel connect directly today; use a bridge or webhook for other CRMs.",
    );
  } else if (answers.hasCrm === "no") {
    stackNotes.push(
      "No CRM yet — use Northstar's built-in CRM now, then add HubSpot or GoHighLevel later if the business needs an external system of record.",
    );
  }

  if (answers.hasPhoneProvider === "yes") {
    stackNotes.push(
      "Existing phone provider — keep it for supported call events and post-call workflows, or forward calls to a managed Twilio number when the package includes native AI answering and live scheduling assistance.",
    );
  }

  if (answers.hasMessagingProvider === "no") {
    stackNotes.push(
      "No SMS/email sender yet — drafts still work and stay approval-gated; connect a sender later to enable delivery.",
    );
  }

  if (answers.hasCalendar === "yes") {
    stackNotes.push(
      "Calendar in use — connect Google Calendar to read real availability and create client-approved appointments.",
    );
  }

  return { sources, stackNotes };
}
