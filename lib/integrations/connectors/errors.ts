export class ConnectorAuthorizationError extends Error {
  readonly reconnectRequired = true;

  constructor(message = "Provider authorization expired. Reconnect the account to resume syncing.") {
    super(message);
    this.name = "ConnectorAuthorizationError";
  }
}

export function isConnectorAuthorizationError(
  error: unknown,
): error is ConnectorAuthorizationError {
  return (
    error instanceof ConnectorAuthorizationError ||
    (error instanceof Error &&
      "reconnectRequired" in error &&
      error.reconnectRequired === true)
  );
}
