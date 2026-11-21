import Link from "next/link";
import { OwnerAreaHeader } from "./owner-ui";

// The authenticated source pages also load private data and refresh controls.
// Keep their public empty presentation separate, with no accounts or loaders.
export function PublicSourceArea({ area }: { area: "calendar" | "money" | "apps" }) {
  if (area === "apps") {
    return <div className="max-w-3xl">
      <OwnerAreaHeader title="Apps & connections" />
      <p className="mt-6 text-sm leading-7 text-slate-500">No accounts connected.</p>
      <p className="mt-2 max-w-xl text-sm leading-7 text-slate-500">Connecting apps requires owner access to a private workspace.</p>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Link href="/start" prefetch={false} className="inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Set up your business</Link>
        <Link href="/preview" className="inline-flex min-h-11 items-center rounded-md text-sm text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">Browse preview</Link>
      </div>
      <details className="mt-6 max-w-xl rounded-xl border border-slate-200 bg-white px-4">
        <summary className="min-h-11 cursor-pointer py-3 text-sm text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">What appears here</summary>
        <p className="pb-4 text-sm leading-7 text-slate-500">Connected app status and imported source records appear here when accounts are available. This public preview does not connect accounts or run work.</p>
      </details>
    </div>;
  }

  return <div className="max-w-3xl">
    <OwnerAreaHeader title={area === "calendar" ? "Calendar" : "Money"} />
    <p className="mt-3 max-w-xl text-sm leading-7 text-slate-500">
      {area === "calendar" ? "Upcoming events from connected calendars." : "Invoices and payment records from connected apps."}
    </p>
    <p className="mt-8 text-sm leading-7 text-slate-500">
      {area === "calendar" ? "No upcoming appointments have been imported." : "No invoice or payment records are available here yet."}
    </p>
    <Link href="/preview/apps" className="mt-4 inline-flex min-h-11 items-center rounded-md text-sm text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2">View Apps</Link>
  </div>;
}
