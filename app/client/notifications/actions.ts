"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import type { FormState } from "@/lib/forms/state";
import {
  isAccessError,
  requirePrimaryClientAccess,
} from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9][0-9]{7,14}$/;

function refreshNotificationSurfaces() {
  revalidatePath("/client");
  revalidatePath("/client/notifications");
  revalidatePath("/client/crm");
}

async function notificationContext() {
  const auth = await getAuthState();
  if (!auth.user) {
    return {
      ok: false as const,
      state: { status: "error", message: "Sign in to manage notifications." },
    };
  }

  try {
    const access = await requirePrimaryClientAccess(auth.user.id);

    if (
      !access.clientId ||
      !access.partnerId ||
      !access.visibleClientSections.includes("notifications")
    ) {
      return {
        ok: false as const,
        state: {
          status: "error",
          message: "Your account does not have notification access.",
        },
      };
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) {
      return {
        ok: false as const,
        state: { status: "error", message: "Notifications are unavailable." },
      };
    }

    return { ok: true as const, user: auth.user, access, supabase };
  } catch (error) {
    if (isAccessError(error)) {
      return {
        ok: false as const,
        state: {
          status: "error",
          message: "Your account does not have notification access.",
        },
      };
    }
    throw error;
  }
}

export async function markClientNotificationRead(
  notificationId: string,
): Promise<void> {
  if (!UUID.test(notificationId)) return;
  const context = await notificationContext();
  if (!context.ok) return;

  const { data: notification } = await context.supabase
    .from("client_notifications")
    .select("id")
    .eq("id", notificationId)
    .eq("client_id", context.access.clientId)
    .maybeSingle();

  if (!notification) return;

  await context.supabase.from("client_notification_reads").upsert(
    {
      notification_id: notification.id,
      user_id: context.user.id,
      read_at: new Date().toISOString(),
    },
    { onConflict: "notification_id,user_id" },
  );
  refreshNotificationSurfaces();
}

export async function markAllClientNotificationsRead(): Promise<void> {
  const context = await notificationContext();
  if (!context.ok) return;

  const { data } = await context.supabase
    .from("client_notifications")
    .select("id")
    .eq("client_id", context.access.clientId)
    .is("resolved_at", null)
    .limit(250);
  const now = new Date().toISOString();
  const rows = (data ?? []).map((notification) => ({
    notification_id: notification.id,
    user_id: context.user.id,
    read_at: now,
  }));

  if (rows.length > 0) {
    await context.supabase
      .from("client_notification_reads")
      .upsert(rows, { onConflict: "notification_id,user_id" });
  }
  refreshNotificationSurfaces();
}

export async function updateClientNotificationPreferences(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await notificationContext();
  if (!context.ok) return context.state as FormState;

  const emailEnabled = formData.get("email_enabled") === "on";
  const smsEnabled = formData.get("sms_enabled") === "on";
  const criticalOnly = formData.get("critical_only") === "on";
  const smsPhone = String(formData.get("sms_phone") ?? "").trim();

  if (smsEnabled && !E164.test(smsPhone)) {
    return {
      status: "error",
      message:
        "Enter the SMS number in international format, such as +13125551234.",
      fieldErrors: { sms_phone: "A valid SMS number is required." },
    };
  }

  const values = {
    partner_id: context.access.partnerId,
    client_id: context.access.clientId,
    user_id: context.user.id,
    email_enabled: emailEnabled,
    sms_enabled: smsEnabled,
    sms_phone: smsEnabled ? smsPhone : null,
    critical_only: criticalOnly,
  };
  const { error } = await context.supabase
    .from("client_notification_preferences")
    .upsert(values, { onConflict: "client_id,user_id" });

  if (error) {
    return {
      status: "error",
      message: "Delivery settings could not be saved.",
    };
  }

  const admin = createSupabaseAdminClient();
  if (admin) {
    for (const [channel, enabled] of [
      ["email", emailEnabled],
      ["sms", smsEnabled],
    ] as const) {
      if (!enabled) {
        await admin
          .from("client_notification_deliveries")
          .update({
            status: "skipped",
            error_message: `${channel.toUpperCase()} delivery was disabled by the user.`,
          })
          .eq("client_id", context.access.clientId)
          .eq("user_id", context.user.id)
          .eq("channel", channel)
          .in("status", ["pending", "failed"]);
      }
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await context.supabase
      .from("client_notifications")
      .select("id, partner_id, client_id, severity")
      .eq("client_id", context.access.clientId)
      .is("resolved_at", null)
      .gte("occurred_at", since)
      .limit(100);
    const eligible = (recent ?? []).filter(
      (notification) =>
        !criticalOnly || notification.severity === "critical",
    );
    const deliveries = eligible.flatMap((notification) => {
      const rows = [];
      if (emailEnabled && context.user.email) {
        rows.push({
          notification_id: notification.id,
          partner_id: notification.partner_id,
          client_id: notification.client_id,
          user_id: context.user.id,
          channel: "email",
          destination: context.user.email,
        });
      }
      if (smsEnabled) {
        rows.push({
          notification_id: notification.id,
          partner_id: notification.partner_id,
          client_id: notification.client_id,
          user_id: context.user.id,
          channel: "sms",
          destination: smsPhone,
        });
      }
      return rows;
    });

    if (deliveries.length > 0) {
      await admin
        .from("client_notification_deliveries")
        .upsert(deliveries, {
          onConflict: "notification_id,user_id,channel",
          ignoreDuplicates: true,
        });
    }
  }

  await recordAuditEvent({
    actor: context.access,
    action: "client.notification_preferences_updated",
    targetType: "notification_preferences",
    summary: "Updated personal notification delivery settings.",
    afterSnapshot: {
      email_enabled: emailEnabled,
      sms_enabled: smsEnabled,
      sms_phone: smsEnabled ? `***${smsPhone.slice(-4)}` : null,
      critical_only: criticalOnly,
    },
  });

  refreshNotificationSurfaces();
  return {
    status: "success",
    message: "Notification delivery settings saved.",
  };
}
