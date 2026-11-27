import Link from "next/link";
import type { ConnectedData } from "@/lib/connections/types";
import { safeSourceUrl, validTimeZone } from "@/lib/business/daily-brief";
export function SyncedMessages({
  data,
  timeZone,
  secondary = false,
}: {
  data: ConnectedData;
  timeZone: string;
  /** Shown below the live inbox: a subsection, not a second page title. */
  secondary?: boolean;
}) {
  const format = (v: string | null) =>
    v && Number.isFinite(Date.parse(v))
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: validTimeZone(timeZone),
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(v))
      : "";
  return (
    <section aria-labelledby="synced-email-title" className={secondary ? "mt-12 border-t border-slate-200 pt-8" : "mb-12"}>
      <div className="flex items-center justify-between gap-4">
        {secondary ? (
          <h2 id="synced-email-title" className="text-base font-semibold tracking-tight">
            Connected email · read only
          </h2>
        ) : (
          <h1 id="synced-email-title" className="text-2xl font-medium tracking-tight">
            Messages
          </h1>
        )}
        <Link href="/client/apps" className="text-xs text-slate-500">
          Connections ↗
        </Link>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-500">
        Recent email from your connected accounts. Open a thread in its source
        app to read or reply.
      </p>
      {data.errors.length ? (
        <p role="alert" className="mt-4 text-sm text-amber-800">
          {data.errors.join(" ")}
        </p>
      ) : null}
      {data.apps.some(
        (a) =>
          a.paused ||
          a.error ||
          a.stale ||
          (a.status === "connected" && !a.lastSyncedAt),
      ) ? (
        <p className="mt-4 text-xs text-slate-500">
          Some accounts are paused, still importing, or need attention.{" "}
          <Link href="/client/apps" className="underline">
            Check sync status
          </Link>
          .
        </p>
      ) : null}
      <div className="mt-7 divide-y divide-slate-100">
        {data.messages.slice(0, 100).map((message) => (
          <article
            key={`${message.connectionId}:${message.threadId}`}
            className="py-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">
                  {message.direction === "outbound" ? "Sent · " : message.direction === "inbound" ? "Received · " : ""}{message.from || "Sender unavailable"}
                  {message.unread ? " · Unread" : ""}
                </p>
                <p
                  className={`mt-1 break-words text-sm ${message.unread ? "font-medium" : "text-slate-700"}`}
                >
                  {safeSourceUrl(message.href) ? (
                    <a
                      href={safeSourceUrl(message.href)!}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {message.subject} ↗
                    </a>
                  ) : (
                    message.subject
                  )}
                </p>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
                  {message.preview}
                </p>
                <p className="mt-2 text-[11px] text-slate-400">
                  {message.account}{message.provider ? ` · ${message.provider === "gmail" || message.provider === "google_workspace" ? "Google" : ["outlook", "microsoft_365"].includes(message.provider) ? "Microsoft" : message.provider.replaceAll("_", " ")}` : ""}
                  {message.messageCount > 1
                    ? ` · ${message.messageCount} imported messages`
                    : ""}
                </p>
              </div>
              <time className="shrink-0 text-right text-[11px] leading-5 text-slate-400">
                {format(message.receivedAt)}
              </time>
            </div>
          </article>
        ))}
      </div>
      {!data.messages.length ? (
        <p className="mt-8 text-sm text-slate-400">
          {data.apps.some((a) => a.status === "connected")
            ? "No recent email has been imported yet."
            : "Connect a supported email account to see recent threads here."}
        </p>
      ) : null}
      {data.limited || data.messages.length > 100 ? (
        <p className="mt-4 text-xs text-slate-400">
          Showing the most recent imported threads. Open the source mail app for
          the complete mailbox.
        </p>
      ) : null}
    </section>
  );
}
