"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <section role="alert" className="rounded-2xl border bg-card p-8">
      <h1 className="text-xl font-semibold">
        This workspace could not be loaded
      </h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your saved work is still in the database. Try again or check the
        connection.
      </p>
      <button
        onClick={reset}
        className="mt-5 rounded-xl bg-primary px-4 py-2 text-sm text-white"
      >
        Try again
      </button>
    </section>
  );
}
