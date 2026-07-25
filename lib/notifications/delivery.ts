import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  sendEmail,
  type EmailCredentials,
} from "@/lib/integrations/providers/email";
import {
  sendSms,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import {
  notificationDeliveryText,
  shouldRetryNotificationDelivery,
} from "@/lib/notifications/client";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const MAX_ATTEMPTS = 3;

type NotificationDelivery = {
  id: string;
  notification_id: string;
  partner_id: string;
  client_id: string;
  user_id: string;
  channel: "email" | "sms";
  destination: string;
  status: "pending" | "failed";
  attempt_count: number;
  last_attempt_at: string | null;
  notification: {
    title: string;
    body: string | null;
    severity: "info" | "warning" | "critical";
    action_path: string | null;
    resolved_at: string | null;
  };
};

type DeliveryConnection = {
  id: string;
  runtime_mode: string;
  status: string;
  error_count: number;
};

export type NotificationDeliveryResult = {
  scanned: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  waiting: number;
};

async function findConnection(
  admin: SupabaseClient,
  delivery: NotificationDelivery,
): Promise<DeliveryConnection | null> {
  const providerKey = delivery.channel === "email" ? "resend" : "twilio";
  const { data } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("partner_id", delivery.partner_id)
    .eq("client_id", delivery.client_id)
    .eq("provider.provider_key", providerKey)
    .in("status", ["connected", "needs_attention"])
    .limit(1)
    .maybeSingle();

  return data as DeliveryConnection | null;
}

async function recordIntegrationEvent(
  admin: SupabaseClient,
  delivery: NotificationDelivery,
  connectionId: string | null,
  status: "sent" | "failed" | "skipped",
  detail: string,
  providerRef?: string,
) {
  await admin.from("integration_events").insert({
    partner_id: delivery.partner_id,
    client_id: delivery.client_id,
    connection_id: connectionId,
    direction: "outbound",
    event_type: `notification.${delivery.channel}`,
    status,
    request_payload: {
      notification_id: delivery.notification_id,
      user_id: delivery.user_id,
      destination:
        delivery.channel === "email"
          ? delivery.destination.replace(/(^.).*(@.*$)/, "$1***$2")
          : `***${delivery.destination.slice(-4)}`,
    },
    response_payload: providerRef ? { provider_ref: providerRef } : {},
    error_message: status === "failed" ? detail : null,
    redacted: true,
  });
}

async function finishDelivery(
  admin: SupabaseClient,
  delivery: NotificationDelivery,
  values: {
    status: "sent" | "failed" | "skipped";
    providerRef?: string | null;
    errorMessage?: string | null;
  },
) {
  const now = new Date().toISOString();
  await admin
    .from("client_notification_deliveries")
    .update({
      status: values.status,
      attempt_count: delivery.attempt_count + 1,
      provider_ref: values.providerRef ?? null,
      error_message: values.errorMessage ?? null,
      last_attempt_at: now,
      sent_at: values.status === "sent" ? now : null,
    })
    .eq("id", delivery.id);
}

async function deliverOne(
  admin: SupabaseClient,
  delivery: NotificationDelivery,
): Promise<"sent" | "failed" | "skipped"> {
  if (delivery.notification.resolved_at) {
    await finishDelivery(admin, delivery, {
      status: "skipped",
      errorMessage: "The notification was resolved before delivery.",
    });
    return "skipped";
  }

  const connection = await findConnection(admin, delivery);

  if (!connection || connection.runtime_mode !== "live") {
    const detail = !connection
      ? `No connected ${delivery.channel === "email" ? "Resend" : "Twilio"} account is available.`
      : `The ${delivery.channel} connection is not in live mode.`;
    await finishDelivery(admin, delivery, {
      status: "skipped",
      errorMessage: detail,
    });
    await recordIntegrationEvent(
      admin,
      delivery,
      connection?.id ?? null,
      "skipped",
      detail,
    );
    return "skipped";
  }

  const actionUrl = `${getAppUrl()}${
    delivery.notification.action_path ?? "/client/notifications"
  }`;
  const message = notificationDeliveryText({
    title: delivery.notification.title,
    body: delivery.notification.body,
    actionUrl,
  });

  try {
    let providerRef: string;

    if (delivery.channel === "email") {
      const credentials = await readProviderCredentials<EmailCredentials>(
        admin,
        connection.id,
      );
      if (!credentials?.apiKey || !credentials.fromEmail) {
        throw new Error("Resend credentials are incomplete.");
      }
      const result = await sendEmail(credentials, {
        to: delivery.destination,
        subject: `${
          delivery.notification.severity === "critical" ? "Urgent: " : ""
        }${delivery.notification.title}`,
        body: message,
      });
      providerRef = result.messageId;
    } else {
      const credentials = await readProviderCredentials<TwilioCredentials>(
        admin,
        connection.id,
      );
      if (
        !credentials?.accountSid ||
        !credentials.authToken ||
        !credentials.fromNumber
      ) {
        throw new Error("Twilio credentials are incomplete.");
      }
      const result = await sendSms(
        credentials,
        delivery.destination,
        message,
      );
      providerRef = result.messageSid;
    }

    await finishDelivery(admin, delivery, {
      status: "sent",
      providerRef,
    });
    await recordIntegrationEvent(
      admin,
      delivery,
      connection.id,
      "sent",
      "Notification delivered.",
      providerRef,
    );
    await admin
      .from("integration_connections")
      .update({
        status: "connected",
        last_success_at: new Date().toISOString(),
      })
      .eq("id", connection.id);
    return "sent";
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Notification delivery failed.";
    await finishDelivery(admin, delivery, {
      status: "failed",
      errorMessage: detail,
    });
    await recordIntegrationEvent(
      admin,
      delivery,
      connection.id,
      "failed",
      detail,
    );
    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        health_summary: `Internal notification delivery failed: ${detail}`,
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
      })
      .eq("id", connection.id);
    return "failed";
  }
}

export async function processPendingNotificationDeliveries(
  limit = 20,
): Promise<NotificationDeliveryResult> {
  const admin = createSupabaseAdminClient();
  const result: NotificationDeliveryResult = {
    scanned: 0,
    attempted: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    waiting: 0,
  };

  if (!admin) return result;

  const { data } = await admin
    .from("client_notification_deliveries")
    .select(
      "id, notification_id, partner_id, client_id, user_id, channel, destination, status, attempt_count, last_attempt_at, notification:client_notifications!inner(title, body, severity, action_path, resolved_at)",
    )
    .in("status", ["pending", "failed"])
    .lt("attempt_count", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(limit);
  const deliveries = (data ?? []) as unknown as NotificationDelivery[];
  result.scanned = deliveries.length;

  for (const delivery of deliveries) {
    if (
      delivery.status === "failed" &&
      !shouldRetryNotificationDelivery(delivery)
    ) {
      result.waiting += 1;
      continue;
    }

    result.attempted += 1;
    const outcome = await deliverOne(admin, delivery);
    result[outcome] += 1;
  }

  return result;
}
