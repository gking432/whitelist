// Caller ID and knowledge of a phone number/email are routing hints, never
// authentication. Existing customer details stay on authenticated staff surfaces.
export const CALLER_PRIVACY_INSTRUCTIONS = `The caller's identity has not been verified. Do not reveal or confirm whether an existing customer record exists, and never disclose stored names, addresses, email addresses, account details, or past work. Ask the caller to state their own contact and service details, one question at a time. Use save_contact_details to record what they state for staff review. A phone number, caller ID, or email address alone is not identity verification.`;

export function mayEnrichVoiceContact(extracted: Record<string, unknown>): boolean {
  const resolution = extracted.caller_resolution;
  return typeof resolution === "object" && resolution !== null &&
    (resolution as Record<string, unknown>).status === "created";
}

export function voiceCallExpired(startedAt: string, configuredSeconds: string | undefined, now = Date.now()): boolean {
  const configured = Number(configuredSeconds);
  const seconds = Number.isFinite(configured) && configured > 0
    ? Math.max(60, Math.min(1200, Math.floor(configured))) : 900;
  const started = Date.parse(startedAt);
  return !Number.isFinite(started) || now - started >= seconds * 1000;
}

export type ActiveCallCandidate = {
  id: string;
  assigned_user_id?: string | null;
};

export function selectActiveCall<T extends ActiveCallCandidate>(
  calls: T[], requestedId?: string | null, userId?: string | null,
): T | null {
  // Never silently replace an explicitly selected call with another caller.
  if (requestedId) return calls.find((call) => call.id === requestedId) ?? null;
  const mine = userId ? calls.find((call) => call.assigned_user_id === userId) : null;
  return mine ?? (calls.length === 1 && !calls[0].assigned_user_id ? calls[0] : null);
}
