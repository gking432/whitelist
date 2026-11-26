const RENEWAL_WINDOW_MS = 24 * 60 * 60 * 1000;
const FAILED_RETRY_DELAY_MS = 15 * 60 * 1000;

export function webhookRenewalCutoff(now = Date.now()): string {
  return new Date(now + RENEWAL_WINDOW_MS).toISOString();
}

export function webhookRenewalRetryReady(
  status: string,
  updatedAt: string,
  now = Date.now(),
): boolean {
  return status === "active" ||
    Date.parse(updatedAt) <= now - FAILED_RETRY_DELAY_MS;
}
