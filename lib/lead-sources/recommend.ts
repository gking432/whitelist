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
} from "@/lib/lead-sources/catalog";

// Turns the partner's plain-language answers into a ranked setup plan per
// lead source. Pure function: UI previews it live and the server stores the
// same result. The first path that is available today becomes "recommended";
// coming-soon paths stay visible so partners see where the product is going.

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
  automation_bridge: {
    label: "Create webhook intake connection",
    hrefSuffix: "/integrations/new",
  },
  generic_webhook: {
    label: "Create webhook intake connection",
    hrefSuffix: "/integrations/new",
  },
  manual_entry: {
    label: "Create webhook intake connection",
    hrefSuffix: "/integrations/new",
  },
};

function pathsForSource(
  source: LeadSourceKey,
  answers: IntakeAnswers,
): PathRecommendation[] {
  const ordered = sourcePathOrder[source];
  let recommendedAssigned = false;

  return ordered.map((path) => {
    const info = setupPathInfo[path];

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

    const eligible = info.status === "available_now" && blockedReason === null;
    const recommended = eligible && !recommendedAssigned;

    if (recommended) {
      recommendedAssigned = true;
    }

    return {
      path,
      label: info.label,
      plainDescription: info.plainDescription,
      howItWorksToday: info.howItWorksToday,
      status: info.status,
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
      "No website: hosted Northstar pages and tracking numbers will carry this client; manual entry and bridges work today.",
    );
  }

  if (answers.hasCrm === "yes") {
    stackNotes.push(
      "Client has a CRM — keep it as the system of record. Most CRMs can send new leads through a bridge or webhook today; native sync adapters are on the roadmap.",
    );
  } else if (answers.hasCrm === "no") {
    stackNotes.push(
      "No CRM yet — Northstar's built-in CRM mode is planned. Until then, runs, approvals, and reports in this workspace are the operational record.",
    );
  }

  if (answers.hasPhoneProvider === "yes") {
    stackNotes.push(
      "Existing phone provider — forward missed-call events through a bridge now; AI answering connects to supported providers later.",
    );
  }

  if (answers.hasMessagingProvider === "no") {
    stackNotes.push(
      "No SMS/email sender yet — drafts still work and stay approval-gated; connect a sender later to enable delivery.",
    );
  }

  if (answers.hasCalendar === "yes") {
    stackNotes.push(
      "Calendar in use — AI scheduling will read real availability once calendar connections ship.",
    );
  }

  return { sources, stackNotes };
}
