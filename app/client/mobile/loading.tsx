export default function MobileOwnerLoading() {
  return (
    <main className="mx-auto max-w-xl px-5 py-12" role="status">
      <p className="text-sm text-muted-foreground">Checking what needs you…</p>
      <div className="mt-6 h-40 animate-pulse rounded-3xl bg-secondary" />
    </main>
  );
}
