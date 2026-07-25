import Link from "next/link";
import {
  Bell,
  BellCheck,
  Check,
  CheckCheck,
  CircleAlert,
  Info,
  TriangleAlert,
} from "lucide-react";
import { redirect } from "next/navigation";

import {
  markAllClientNotificationsRead,
  markClientNotificationRead,
  updateClientNotificationPreferences,
} from "@/app/client/notifications/actions";
import { NotificationPreferencesForm } from "@/components/client/notification-preferences-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { loadClientPortal } from "@/lib/clients/portal";
import { formatDateTime, formatEnum } from "@/lib/format";
import { loadClientNotificationInbox } from "@/lib/notifications/client";
import { clientHomePath } from "@/lib/permissions/client-sections";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const severityStyles = {
  critical: {
    icon: CircleAlert,
    panel: "border-l-red-500",
    iconClass: "text-red-600",
    badge: "border-red-200 bg-red-50 text-red-800",
  },
  warning: {
    icon: TriangleAlert,
    panel: "border-l-amber-500",
    iconClass: "text-amber-600",
    badge: "border-amber-200 bg-amber-50 text-amber-800",
  },
  info: {
    icon: Info,
    panel: "border-l-sky-500",
    iconClass: "text-sky-600",
    badge: "border-sky-200 bg-sky-50 text-sky-800",
  },
} as const;

export default async function ClientNotificationsPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !portal.access.clientId) return null;

  if (!portal.access.visibleClientSections.includes("notifications")) {
    redirect(
      clientHomePath(
        portal.access.visibleClientSections,
        portal.client.client_experience_mode,
      ),
    );
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const inbox = await loadClientNotificationInbox(
    supabase,
    portal.access.clientId,
    portal.user.id,
  );
  const open = inbox.notifications.filter(
    (notification) => notification.resolved_at === null,
  );
  const resolved = inbox.notifications.filter(
    (notification) => notification.resolved_at !== null,
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bell className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Notifications</h1>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Operational alerts routed to you based on your role and workspace
            permissions.
          </p>
        </div>
        {inbox.unreadCount > 0 ? (
          <form action={markAllClientNotificationsRead}>
            <Button type="submit" size="sm" variant="outline">
              <CheckCheck aria-hidden="true" />
              Mark all read
            </Button>
          </form>
        ) : (
          <Badge variant="outline">All caught up</Badge>
        )}
      </header>

      <section aria-labelledby="active-notifications-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="active-notifications-heading" className="font-semibold">
            Needs attention
          </h2>
          <span className="text-xs text-muted-foreground">
            {open.length} active
          </span>
        </div>

        {open.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
            <BellCheck
              className="size-6 text-emerald-600"
              aria-hidden="true"
            />
            <h3 className="mt-3 text-sm font-semibold">No alerts</h3>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              New approval requests, failures, urgent leads, missed calls, and
              scheduling conflicts will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {open.map((notification) => {
              const style = severityStyles[notification.severity];
              const Icon = style.icon;

              return (
                <article
                  key={notification.id}
                  className={cn(
                    "border-l-4 bg-card px-4 py-4 sm:px-5",
                    style.panel,
                    notification.isRead
                      ? "border-y border-r"
                      : "border-y border-r shadow-sm",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Icon
                      className={cn("mt-0.5 size-5 shrink-0", style.iconClass)}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-semibold">
                            {notification.title}
                          </h3>
                          {notification.body ? (
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {notification.body}
                            </p>
                          ) : null}
                        </div>
                        <Badge variant="outline" className={style.badge}>
                          {formatEnum(notification.severity)}
                        </Badge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {notification.action_path ? (
                          <Button asChild size="sm">
                            <Link href={notification.action_path}>
                              Open details
                            </Link>
                          </Button>
                        ) : null}
                        {!notification.isRead ? (
                          <form
                            action={markClientNotificationRead.bind(
                              null,
                              notification.id,
                            )}
                          >
                            <Button type="submit" size="sm" variant="ghost">
                              <Check aria-hidden="true" />
                              Mark read
                            </Button>
                          </form>
                        ) : null}
                        <span className="ml-auto text-xs text-muted-foreground">
                          {formatDateTime(notification.occurred_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        aria-labelledby="delivery-settings-heading"
        className="border-t pt-6"
      >
        <h2 id="delivery-settings-heading" className="font-semibold">
          Delivery settings
        </h2>
        <p className="mt-1 mb-4 text-sm leading-6 text-muted-foreground">
          In-app alerts are always available here. Email and SMS use your
          business&apos;s connected live Resend and Twilio accounts.
        </p>
        <NotificationPreferencesForm
          action={updateClientNotificationPreferences}
          initial={inbox.preferences}
          email={portal.user.email ?? "No email on file"}
        />
      </section>

      {resolved.length > 0 ? (
        <section
          aria-labelledby="resolved-notifications-heading"
          className="border-t pt-6"
        >
          <h2 id="resolved-notifications-heading" className="font-semibold">
            Recently resolved
          </h2>
          <div className="mt-3 divide-y rounded-lg border bg-card">
            {resolved.slice(0, 15).map((notification) => (
              <div
                key={notification.id}
                className="flex items-start gap-3 px-4 py-3.5"
              >
                <CheckCheck
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{notification.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Resolved {formatDateTime(notification.resolved_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
