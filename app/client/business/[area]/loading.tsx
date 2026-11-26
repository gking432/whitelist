export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading business workspace"
      className="animate-pulse space-y-6"
    >
      <div className="h-4 w-40 rounded bg-secondary" />
      <div className="h-10 w-64 rounded-xl bg-secondary" />
      <div className="grid gap-4 sm:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-52 rounded-2xl border bg-card" />
        ))}
      </div>
      <span className="sr-only">Loading your business records…</span>
    </div>
  );
}
