"use client";
export default function MobileOwnerError({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-5 py-12">
      <h1 className="text-xl font-semibold">We couldn’t load your business</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Your approvals haven’t changed. Please try again.
      </p>
      <button
        onClick={reset}
        className="mt-6 min-h-12 rounded-xl bg-primary px-5 text-primary-foreground"
      >
        Try again
      </button>
    </main>
  );
}
