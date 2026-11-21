"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/monitoring/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "browser",
        name: error.name,
        message: error.message || "Unhandled application error",
        stack: error.stack,
        path: location.pathname,
        digest: error.digest,
      }),
      keepalive: true,
    }).catch(() => undefined);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <main className="w-full max-w-md rounded-lg border bg-card p-6 text-center">
          <h1 className="text-lg font-semibold">This page could not load</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The issue was reported automatically. Try the page again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
