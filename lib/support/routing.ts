import type {
  SupportCategory,
  SupportHealthContext,
  SupportOrigin,
  SupportPriority,
  SupportRoute,
  SupportTriage,
} from "./types.ts";

const categoryHints: { category: SupportCategory; words: string[] }[] = [
  { category: "security", words: ["security", "breach", "hacked", "compromised", "leak", "unauthorized"] },
  { category: "billing", words: ["billing", "invoice", "charged", "refund", "payment", "subscription"] },
  { category: "permissions", words: ["permission", "access", "role", "login", "sign in", "locked out"] },
  { category: "integration_request", words: ["connect", "connector", "integration", "api", "webhook", "doesn't support"] },
  { category: "feature_request", words: ["new feature", "could you add", "would like you to add", "new capability"] },
  { category: "bug", words: ["bug", "broken", "error", "crash", "not working", "failed"] },
  { category: "setup", words: ["setup", "set up", "configure", "onboard", "install"] },
  { category: "how_to", words: ["how do", "how to", "where is", "help me use"] },
];

function includesAny(text: string, words: string[]) {
  return words.some((word) => text.includes(word));
}

export function fallbackSupportTriage(input: {
  origin: SupportOrigin;
  title: string;
  description: string;
  health: SupportHealthContext;
}): SupportTriage {
  const text = `${input.title} ${input.description}`.toLowerCase();
  const matched = categoryHints.find((item) => includesAny(text, item.words));
  let category: SupportCategory = matched?.category ?? "other";

  if (input.health.recentFailedRuns > 0 || input.health.failingConnections > 0) {
    if (category === "other" || category === "how_to") category = "incident";
  }

  const criticalLanguage = includesAny(text, [
    "all customers",
    "data loss",
    "emergency",
    "production down",
    "security",
    "breach",
  ]);
  const priority: SupportPriority = criticalLanguage
    ? "critical"
    : input.health.recentFailedRuns > 2 || input.health.failingConnections > 1
      ? "important"
      : "normal";

  let recommendedRoute: SupportRoute;
  if (input.origin === "client") {
    recommendedRoute = "partner";
  } else if (priority === "critical" || ["billing", "security", "permissions"].includes(category)) {
    recommendedRoute = "owner";
  } else if (["bug", "integration_request", "feature_request"].includes(category)) {
    recommendedRoute = "codex";
  } else if (["how_to", "setup"].includes(category)) {
    recommendedRoute = "support_ai";
  } else {
    recommendedRoute = "platform";
  }

  const healthEvidence = [
    input.health.failingConnections > 0
      ? `${input.health.failingConnections} connection issue${input.health.failingConnections === 1 ? "" : "s"}`
      : null,
    input.health.recentFailedRuns > 0
      ? `${input.health.recentFailedRuns} recent failed automation run${input.health.recentFailedRuns === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return {
    category,
    priority,
    summary: input.title.trim().slice(0, 180),
    diagnosis: healthEvidence.length > 0
      ? `Account health shows ${healthEvidence.join(" and ")}. This may be related and should be checked before changing configuration.`
      : "No matching account-health failure was found. Review the request and reproduce it before changing configuration.",
    recommendedAction: category === "how_to" || category === "setup"
      ? "Check the account setup and approved operating guide, then reply with exact next steps."
      : "Review the linked account activity, reproduce the issue, and document the result before escalating or changing code.",
    recommendedRoute,
    confidence: healthEvidence.length > 0 || matched ? "medium" : "low",
  };
}
