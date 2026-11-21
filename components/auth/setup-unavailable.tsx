import Link from "next/link";

export function SetupUnavailable({ message }: { message: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-6 py-10 text-slate-900">
      <section aria-labelledby="setup-title" className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8">
        <h1 id="setup-title" className="text-2xl font-semibold tracking-tight">Business setup unavailable</h1>
        <p role="status" className="mt-3 text-sm leading-7 text-slate-600">{message}</p>
        <p className="mt-3 text-sm leading-7 text-slate-500">A private workspace is required before you can connect apps and use your business data. You can still browse the preview.</p>
        <div className="mt-6 flex flex-wrap gap-4">
          <a href="/start" className="inline-flex min-h-11 items-center rounded-xl bg-blue-700 px-4 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Check again</a>
          <Link href="/preview" className="inline-flex min-h-11 items-center rounded-lg text-sm text-slate-600 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Browse preview</Link>
        </div>
      </section>
    </main>
  );
}
