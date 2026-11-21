export type ContextDiagnosticStage = "configuration" | "auth_user" | "session_actor" | "primary_membership" | "client_scope" | "portal_access" | "portal_client" | "workspace_sections" | "impersonation";
export type ContextDiagnostic = { stage: ContextDiagnosticStage; kind: "denied" | "unavailable"; status: number | null; code: string | null };
export type ContextDiagnosticObserver = (event: ContextDiagnostic) => void;

const stages = new Set<ContextDiagnosticStage>(["configuration", "auth_user", "session_actor", "primary_membership", "client_scope", "portal_access", "portal_client", "workspace_sections", "impersonation"]);
const codes = new Set([
  "42501", "40001", "40P01", "53300", "53400", "57014", "08000", "08001", "08003", "08006", "57P01", "57P02", "57P03",
  "PGRST000", "PGRST001", "PGRST002", "PGRST003", "PGRST100", "PGRST102", "PGRST116", "PGRST202", "PGRST203", "PGRST204", "PGRST300", "PGRST301", "PGRST302", "PGRST303",
  "bad_jwt", "invalid_jwt", "jwt_expired", "invalid_token", "no_authorization", "user_not_found", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "invalid_credentials", "user_banned",
  "unexpected_failure", "request_timeout", "over_request_rate_limit", "over_email_send_rate_limit", "validation_failed",
]);

function contextDiagnosticField(error: unknown, key: "stage" | "kind" | "status" | "statusCode" | "code" | "name"): unknown {
  try { return error !== null && (typeof error === "object" || typeof error === "function") ? (error as Record<string, unknown>)[key] : undefined; }
  catch { return undefined; }
}
function safeStatus(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

/** Validate an existing event for serialization, copying only its fixed fields.
 * Unknown stages/kinds or non-null unapproved metadata are not events. */
export function sanitizeContextDiagnostic(value: unknown): ContextDiagnostic | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const stage = contextDiagnosticField(value, "stage"), kind = contextDiagnosticField(value, "kind");
  const status = contextDiagnosticField(value, "status"), code = contextDiagnosticField(value, "code");
  if (typeof stage !== "string" || !stages.has(stage as ContextDiagnosticStage) || (kind !== "denied" && kind !== "unavailable") ||
      (status !== null && safeStatus(status) === null) || (code !== null && (typeof code !== "string" || !codes.has(code)))) return null;
  return Object.freeze({ stage: stage as ContextDiagnosticStage, kind, status: safeStatus(status), code: code as string | null });
}

/** Fixed categories only: never forward messages, actors, rows or credentials.
 * An observer is diagnostic only and cannot change the access decision. */
export function notifyContextFailure(
  observer: ContextDiagnosticObserver | undefined,
  stage: ContextDiagnosticStage,
  kind: "denied" | "unavailable",
  error?: unknown,
  status?: unknown,
): ContextDiagnostic {
  const candidate = contextDiagnosticField(error, "code");
  const event: ContextDiagnostic = Object.freeze({
    stage: stages.has(stage) ? stage : "configuration",
    kind: kind === "denied" ? "denied" : "unavailable",
    status: safeStatus(status) ?? safeStatus(contextDiagnosticField(error, "status")) ?? safeStatus(contextDiagnosticField(error, "statusCode")),
    code: typeof candidate === "string" && codes.has(candidate) ? candidate : null,
  });
  try {
    const observed: unknown = observer?.(event);
    if (observed !== undefined) void Promise.resolve(observed).catch(() => {});
  } catch { /* Observability never grants or denies access. */ }
  return event;
}

/** Known credential/permission failures are denied. Unrecognized or transient
 * failures remain unavailable; neither outcome permits access or retries. */
export function classifyContextFailure(error: unknown, status?: unknown): ContextDiagnostic["kind"] {
  const event = notifyContextFailure(undefined, "configuration", "unavailable", error, status);
  if (event.status === 429 || (event.status !== null && event.status >= 500) ||
      event.code === "40001" || event.code === "40P01" || event.code === "PGRST003") return "unavailable";
  const name = contextDiagnosticField(error, "name");
  if (event.status === 401 || event.status === 403 ||
      ["42501", "PGRST301", "PGRST302", "PGRST303", "bad_jwt", "invalid_jwt", "jwt_expired", "invalid_token", "no_authorization", "user_not_found", "session_not_found", "refresh_token_not_found", "refresh_token_already_used", "invalid_credentials", "user_banned"].includes(event.code ?? "") ||
      (typeof name === "string" && ["AuthSessionMissingError", "AuthInvalidJwtError", "AuthInvalidCredentialsError"].includes(name))) return "denied";
  return "unavailable";
}
