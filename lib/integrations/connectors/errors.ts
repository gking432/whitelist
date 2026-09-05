export class ConnectorAuthorizationError extends Error {
  readonly reconnectRequired = true;

  constructor(message = "Provider authorization expired. Reconnect the account to resume syncing.") {
    super(message);
    this.name = "ConnectorAuthorizationError";
  }
}

export class ConnectorHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ConnectorHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(86_400, Math.ceil(seconds))) : null;
}

export function connectorHttpError(provider: string, response: Response): Error {
  if (response.status === 401 || response.status === 403) {
    return new ConnectorAuthorizationError(`${provider} authorization was rejected (${response.status}). Reconnect with the required permissions.`);
  }
  return new ConnectorHttpError(
    `${provider} request failed (${response.status}).`,
    response.status,
    parseRetryAfter(response.headers.get("retry-after")),
  );
}

export function isConnectorAuthorizationError(error: unknown): error is ConnectorAuthorizationError {
  return error instanceof ConnectorAuthorizationError ||
    (error instanceof Error && "reconnectRequired" in error && error.reconnectRequired === true);
}

export function connectorFailurePolicy(error: unknown, input: {
  direction: "pull" | "push";
  attempts: number;
  maxAttempts: number;
  writeStarted?: boolean;
}) {
  const reconnectRequired = isConnectorAuthorizationError(error);
  const exhausted = input.attempts + 1 >= input.maxAttempts;
  // A server rejection of a write may have happened after commit. Only an explicit
  // rate-limit rejection is safe to replay automatically; all other started
  // writes require reconciliation, even when the provider supports idempotency.
  const uncertainWrite = input.direction === "push" && input.writeStarted === true &&
    !reconnectRequired && !(error instanceof ConnectorHttpError && error.status === 429);
  const permanent = error instanceof ConnectorHttpError && error.status >= 400 && error.status < 500 &&
    ![408, 429].includes(error.status);
  return {
    reconnectRequired,
    uncertainWrite,
    retryable: !reconnectRequired && !exhausted && !uncertainWrite && !permanent,
    retryAfterSeconds: error instanceof ConnectorHttpError ? error.retryAfterSeconds : null,
  };
}

export class ConnectorExecutionCancelledError extends Error {
  constructor() { super("Connector execution cancelled because its connection was paused, disabled, or changed."); }
}
