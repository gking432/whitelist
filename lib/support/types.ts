export const SUPPORT_CATEGORIES = [
  "how_to",
  "setup",
  "incident",
  "bug",
  "integration_request",
  "feature_request",
  "billing",
  "security",
  "permissions",
  "other",
] as const;

export const SUPPORT_PRIORITIES = ["normal", "important", "critical"] as const;
export const SUPPORT_ROUTES = ["partner", "support_ai", "platform", "codex", "owner"] as const;

export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];
export type SupportRoute = (typeof SUPPORT_ROUTES)[number];
export type SupportOrigin = "client" | "partner" | "platform" | "system";

export type SupportHealthContext = {
  failingConnections: number;
  recentFailedRuns: number;
  recentSuccessfulRuns: number;
  latestError?: string | null;
};

export type SupportTriage = {
  category: SupportCategory;
  priority: SupportPriority;
  summary: string;
  diagnosis: string;
  recommendedAction: string;
  recommendedRoute: SupportRoute;
  confidence: "low" | "medium" | "high";
};

