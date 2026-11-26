function reportClientError(error: unknown) {
  if (location.pathname.startsWith("/api/monitoring/")) return;

  const value = error instanceof Error ? error : new Error(String(error));
  const body = JSON.stringify({
    source: "browser",
    name: value.name,
    message: value.message || "Unhandled browser error",
    stack: value.stack,
    path: location.pathname,
  });

  try {
    navigator.sendBeacon(
      "/api/monitoring/client-error",
      new Blob([body], { type: "application/json" }),
    );
  } catch {
    // A telemetry failure must not interrupt the user.
  }
}

window.addEventListener("error", (event) => reportClientError(event.error));
window.addEventListener("unhandledrejection", (event) =>
  reportClientError(event.reason),
);
