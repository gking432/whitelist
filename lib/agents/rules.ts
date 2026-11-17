import type { WorkStatus } from "./types.ts";

export function leadIsStale(
  lead: {
    status: string;
    created_at: string;
    updated_at: string;
    last_contact_at: string | null;
  },
  hours: number,
  now = Date.now(),
  latestActivity?: string | null,
) {
  if (!["new", "contacted", "qualified", "quoted"].includes(lead.status))
    return false;
  const dates = [
    lead.created_at,
    lead.updated_at,
    lead.last_contact_at,
    latestActivity,
  ]
    .filter(Boolean)
    .map((d) => Date.parse(d!));
  if (dates.some((d) => !Number.isFinite(d))) return false;
  return now - Math.max(...dates) >= Math.max(1, hours) * 3_600_000;
}
export function deliveryWorkState(
  status: string | undefined,
  attempts = 0,
): {
  status: WorkStatus;
  summary: string;
} {
  if (status === "succeeded")
    return {
      status: "completed",
      summary:
        "The connected provider accepted the approved follow-up. This does not establish recipient delivery or a sale.",
    };
  if (status === "uncertain")
    return {
      status: "blocked",
      summary:
        "Delivery outcome is uncertain. Reconcile the existing action before any resend.",
    };
  if (status === "cancelled")
    return {
      status: "cancelled",
      summary:
        "The delivery action was cancelled. No replacement message was created.",
    };
  if (status === "failed" && attempts >= 5)
    return {
      status: "blocked",
      summary:
        "Delivery retries are exhausted. Review the existing delivery action before retrying.",
    };
  if (status === "failed")
    return {
      status: "waiting_external",
      summary:
        "Delivery failed. The existing action queue controls retries; no replacement message was created.",
    };
  if (status === "dry_run" || status === "skipped")
    return {
      status: "blocked",
      summary:
        "No live message was sent. Review the connection and existing action before retrying.",
    };
  return {
    status: "waiting_external",
    summary:
      "Approval recorded; waiting for the existing delivery action to finish.",
  };
}
export function purchaseWorkState(status: string): {
  status: WorkStatus;
  summary: string;
} {
  if (status === "received")
    return {
      status: "completed",
      summary:
        "The purchase was recorded as received and local inventory was updated by the receiving workflow.",
    };
  if (["rejected", "archived"].includes(status))
    return {
      status: "cancelled",
      summary:
        "The purchase was declined or archived. No replacement order was created.",
    };
  if (status === "approved")
    return {
      status: "waiting_external",
      summary:
        "Owner action needed: place the supplier order and record its reference in Purchasing. Automatic supplier ordering is not connected.",
    };
  if (status === "ordered")
    return {
      status: "waiting_external",
      summary:
        "An external order reference is recorded. Waiting for a person to record receipt.",
    };
  return {
    status: "waiting_approval",
    summary: "Purchase proposal prepared; waiting for owner approval.",
  };
}
export function childWorkState(statuses: WorkStatus[]) {
  const blocked = statuses.filter((s) => s === "blocked").length;
  const finished = statuses.filter((s) =>
    ["completed", "cancelled"].includes(s),
  ).length;
  return {
    status: (finished === statuses.length
      ? "completed"
      : "waiting_children") as WorkStatus,
    summary: `${finished} of ${statuses.length} assignments finished${blocked ? `; ${blocked} need attention` : ""}. Completed work and cancelled work remain distinguishable in the linked assignments.`,
  };
}
