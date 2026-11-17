import { ConnectedDataRefresh } from "@/components/business/connected-data-refresh";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connectionsContext } from "@/lib/connections/context";
import { readConnectedData } from "@/lib/connections/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validTimeZone, localDate, safeSourceUrl } from "@/lib/business/daily-brief";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Calendar" } };
export default async function CalendarPage() {
  const ctx = await connectionsContext();
  if (!ctx) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p role="alert">The data service is unavailable.</p>;
  const data = await readConnectedData(admin, ctx.scope),
    timeZone = validTimeZone(ctx.portal.client.timezone);
  const today = localDate(data.generatedAt, timeZone);
  const events = data.appointments.filter((a) =>
    a.allDay
      ? a.endAt > today
      : Date.parse(a.endAt) > Date.parse(data.generatedAt),
  );
  return (
    <div>
      <ConnectedDataRefresh />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-medium tracking-tight">Calendar</h1>
        <Link href="/client/apps" className="text-xs text-slate-500">
          Connections ↗
        </Link>
      </div>
      <p className="mt-3 text-sm text-slate-500">
        Upcoming events from your connected calendars · {timeZone}
      </p>
      {data.errors.length ? (
        <p role="alert" className="mt-5 text-sm text-amber-800">
          {data.errors.join(" ")}
        </p>
      ) : null}
      {data.apps.some(
        (a) => a.streams?.some((stream) => stream.key === "appointment" && stream.status !== "fresh") ||
          ((!a.streams || !a.streams.length) && ["google_workspace", "microsoft_365", "google_calendar"].includes(a.provider) && (a.paused || a.error || a.stale || !a.lastSyncedAt)),
      ) ? (
        <p className="mt-4 text-xs text-slate-500">
          Some calendar data may be waiting for an update.{" "}
          <Link href="/client/apps" className="underline">
            Check sync status
          </Link>
          .
        </p>
      ) : null}
      <div className="mt-7 max-w-2xl divide-y divide-slate-100">
        {events.map((a) => (
          <article
            key={a.id}
            className="flex items-start justify-between gap-5 py-4"
          >
            <div>
              <p className="text-sm">
                {safeSourceUrl(a.href) ? (
                  <a href={safeSourceUrl(a.href)!} target="_blank" rel="noopener noreferrer">
                    {a.title} ↗
                  </a>
                ) : (
                  a.title
                )}
              </p>
              <p className="mt-1 text-xs text-slate-400">{a.account}{a.status === "proposed" ? " · Proposed" : ""}</p>
            </div>
            <p className="text-right text-xs text-slate-500">
              {a.allDay
                ? `${a.startAt} · All day`
                : new Intl.DateTimeFormat("en-US", {
                    timeZone,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(a.startAt))}
            </p>
          </article>
        ))}
      </div>
      {!events.length ? (
        <p className="mt-8 text-sm text-slate-400">
          No upcoming appointments have been imported.
        </p>
      ) : null}
      {data.limited ? (
        <p className="mt-4 text-xs text-slate-400">
          This view contains a limited set of imported events. Open the source
          calendar for its full schedule.
        </p>
      ) : null}
    </div>
  );
}
