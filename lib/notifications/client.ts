import type { SupabaseClient } from "@supabase/supabase-js";

export type ClientNotificationSeverity = "info" | "warning" | "critical";

export type ClientNotificationRecord = {
  id: string;
  kind: string;
  severity: ClientNotificationSeverity;
  title: string;
  body: string | null;
  source_type: string;
  source_id: string | null;
  action_path: string | null;
  occurred_at: string;
  resolved_at: string | null;
};

export type ClientNotificationPreference = {
  email_enabled: boolean;
  sms_enabled: boolean;
  sms_phone: string | null;
  critical_only: boolean;
};

export type ClientNotificationInbox = {
  notifications: Array<ClientNotificationRecord & { isRead: boolean }>;
  unreadCount: number;
  preferences: ClientNotificationPreference;
};

export const DEFAULT_NOTIFICATION_PREFERENCES: ClientNotificationPreference = {
  email_enabled: true,
  sms_enabled: false,
  sms_phone: null,
  critical_only: false,
};

const MAX_DELIVERY_ATTEMPTS = 3;
const DELIVERY_RETRY_WAIT_MS = 5 * 60 * 1000;

export function unreadNotificationCount(
  notifications: Pick<ClientNotificationRecord, "id" | "resolved_at">[],
  readIds: ReadonlySet<string>,
): number {
  return notifications.filter(
    (notification) =>
      notification.resolved_at === null && !readIds.has(notification.id),
  ).length;
}

export function notificationDeliveryText(input: {
  title: string;
  body: string | null;
  actionUrl: string;
  maxLength?: number;
}): string {
  const content = [input.title, input.body, input.actionUrl]
    .filter(Boolean)
    .join("\n");
  const maxLength = input.maxLength ?? 1500;

  if (content.length <= maxLength) return content;
  return `${content.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function shouldRetryNotificationDelivery(
  delivery: {
    status: string;
    attempt_count: number;
    last_attempt_at: string | null;
  },
  now = new Date(),
): boolean {
  if (
    delivery.status !== "failed" ||
    delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS
  ) {
    return false;
  }

  if (!delivery.last_attempt_at) return true;
  return (
    now.getTime() - Date.parse(delivery.last_attempt_at) >=
    DELIVERY_RETRY_WAIT_MS
  );
}

export async function loadClientNotificationInbox(
  supabase: SupabaseClient,
  clientId: string,
  userId: string,
  limit = 75,
): Promise<ClientNotificationInbox> {
  const [notificationsResult, readsResult, preferencesResult] =
    await Promise.all([
      supabase
        .from("client_notifications")
        .select(
          "id, kind, severity, title, body, source_type, source_id, action_path, occurred_at, resolved_at",
        )
        .eq("client_id", clientId)
        .order("occurred_at", { ascending: false })
        .limit(limit),
      supabase
        .from("client_notification_reads")
        .select("notification_id")
        .eq("user_id", userId),
      supabase
        .from("client_notification_preferences")
        .select("email_enabled, sms_enabled, sms_phone, critical_only")
        .eq("client_id", clientId)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  const notifications =
    (notificationsResult.data ?? []) as ClientNotificationRecord[];
  const readIds = new Set(
    (readsResult.data ?? []).map((row) => row.notification_id as string),
  );
  const preferences = preferencesResult.data
    ? (preferencesResult.data as ClientNotificationPreference)
    : DEFAULT_NOTIFICATION_PREFERENCES;

  return {
    notifications: notifications.map((notification) => ({
      ...notification,
      isRead: readIds.has(notification.id),
    })),
    unreadCount: unreadNotificationCount(notifications, readIds),
    preferences,
  };
}

export async function loadUnreadNotificationCount(
  supabase: SupabaseClient,
  clientId: string,
  userId: string,
): Promise<number> {
  const inbox = await loadClientNotificationInbox(
    supabase,
    clientId,
    userId,
    200,
  );
  return inbox.unreadCount;
}
