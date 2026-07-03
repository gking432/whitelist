import type { ClientStatus } from "@/lib/clients/constants";

export type ClientHealthStatus =
  | "healthy"
  | "attention"
  | "failing"
  | "paused"
  | "onboarding";

export type ClientOpsCounts = {
  connectionsTotal: number;
  connectionsFailing: number;
  connectionsNeedsAttention: number;
  activeWorkflows: number;
  pausedLiveWorkflows: number;
  runs7d: number;
  failedRuns7d: number;
  pendingApprovals: number;
  lastEventAt: string | null;
};

export const emptyOpsCounts: ClientOpsCounts = {
  connectionsTotal: 0,
  connectionsFailing: 0,
  connectionsNeedsAttention: 0,
  activeWorkflows: 0,
  pausedLiveWorkflows: 0,
  runs7d: 0,
  failedRuns7d: 0,
  pendingApprovals: 0,
  lastEventAt: null,
};

const APPROVAL_BACKLOG_THRESHOLD = 3;
const FAILING_RUN_THRESHOLD = 3;

export type ClientHealthResult = {
  status: ClientHealthStatus;
  reasons: string[];
};

export function computeClientHealth(
  clientStatus: ClientStatus,
  counts: ClientOpsCounts,
): ClientHealthResult {
  if (clientStatus === "paused") {
    return { status: "paused", reasons: ["Client operations are paused."] };
  }

  const reasons: string[] = [];

  if (counts.connectionsFailing > 0) {
    reasons.push(
      `${counts.connectionsFailing} integration connection${counts.connectionsFailing === 1 ? "" : "s"} failing.`,
    );
  }

  if (counts.failedRuns7d > 0) {
    reasons.push(
      `${counts.failedRuns7d} failed workflow run${counts.failedRuns7d === 1 ? "" : "s"} in the last 7 days.`,
    );
  }

  if (counts.pendingApprovals >= APPROVAL_BACKLOG_THRESHOLD) {
    reasons.push(`${counts.pendingApprovals} approvals waiting for review.`);
  }

  if (counts.pausedLiveWorkflows > 0) {
    reasons.push(
      `${counts.pausedLiveWorkflows} live workflow${counts.pausedLiveWorkflows === 1 ? "" : "s"} paused.`,
    );
  }

  if (counts.connectionsNeedsAttention > 0) {
    reasons.push(
      `${counts.connectionsNeedsAttention} connection${counts.connectionsNeedsAttention === 1 ? "" : "s"} need attention.`,
    );
  }

  if (
    counts.connectionsFailing > 0 ||
    counts.failedRuns7d >= FAILING_RUN_THRESHOLD
  ) {
    return { status: "failing", reasons };
  }

  if (clientStatus === "at_risk") {
    reasons.push("Client is marked at risk.");
    return { status: "attention", reasons };
  }

  if (reasons.length > 0) {
    return { status: "attention", reasons };
  }

  if (clientStatus === "onboarding") {
    return { status: "onboarding", reasons: ["Client setup is in progress."] };
  }

  return { status: "healthy", reasons: [] };
}
