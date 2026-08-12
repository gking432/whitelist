export type ActionDeliveryOutcome = {
  status: string;
  detail: string;
};

export function actionJobOutcomeFields(outcome: ActionDeliveryOutcome) {
  return {
    status: outcome.status,
    outcome_detail: outcome.detail,
    last_error: outcome.status === "failed" ? outcome.detail : null,
  };
}

export function isRetryableJobStatus(status: string): boolean {
  return ["failed", "dry_run", "skipped"].includes(status);
}
