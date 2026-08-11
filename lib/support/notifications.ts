import type { SupabaseClient } from "@supabase/supabase-js";

import { getAppUrl } from "@/lib/env";
import { sendEmail } from "@/lib/integrations/providers/email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

type RecipientKind = "partner" | "platform";

async function recipientProfiles(
  admin: SupabaseClient,
  input: { partnerId: string; kind: RecipientKind },
) {
  let memberships = admin
    .from("memberships")
    .select("user_id")
    .eq("status", "active")
    .is("client_id", null);

  if (input.kind === "partner") {
    memberships = memberships
      .eq("partner_id", input.partnerId)
      .in("role", ["partner_owner", "partner_admin"]);
  } else {
    memberships = memberships
      .is("partner_id", null)
      .in("role", ["platform_owner", "platform_admin"]);
  }

  const { data } = await memberships;
  const userIds = (data ?? []).map((membership) => membership.user_id);
  if (userIds.length === 0) return [];
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .in("id", userIds);
  return profiles ?? [];
}

export async function queueSupportNotification(input: {
  admin: SupabaseClient;
  ticketId: string;
  partnerId: string;
  kind: RecipientKind;
  title: string;
  summary: string;
  urgent?: boolean;
}) {
  const recipients = await recipientProfiles(input.admin, {
    partnerId: input.partnerId,
    kind: input.kind,
  });
  const path = input.kind === "partner"
    ? `/partner/support/${input.ticketId}`
    : `/control/support/${input.ticketId}`;
  const subject = `${input.urgent ? "Urgent: " : ""}${input.title}`;
  const body = `${input.summary}\n\nOpen the support request: ${getAppUrl()}${path}`;

  if (recipients.length > 0) {
    await input.admin.from("support_notification_outbox").upsert(
      recipients.map((recipient) => ({
        ticket_id: input.ticketId,
        partner_id: input.partnerId,
        recipient_kind: input.kind,
        recipient_user_id: recipient.id,
        destination: recipient.email,
        subject,
        body,
      })),
      { onConflict: "ticket_id,recipient_kind,destination", ignoreDuplicates: true },
    );
  }
}

export type SupportNotificationResult = {
  scanned: number;
  sent: number;
  failed: number;
  waitingForConfiguration: number;
};

export async function processPendingSupportNotifications(
  limit = 20,
): Promise<SupportNotificationResult> {
  const result: SupportNotificationResult = {
    scanned: 0,
    sent: 0,
    failed: 0,
    waitingForConfiguration: 0,
  };
  const admin = createSupabaseAdminClient();
  if (!admin) return result;

  const { data } = await admin
    .from("support_notification_outbox")
    .select("id, destination, subject, body, attempt_count")
    .in("status", ["pending", "failed"])
    .lt("attempt_count", 3)
    .order("created_at")
    .limit(limit);
  const deliveries = data ?? [];
  result.scanned = deliveries.length;

  const apiKey = process.env.PLATFORM_RESEND_API_KEY;
  const fromEmail = process.env.PLATFORM_ALERT_FROM_EMAIL;
  if (!apiKey || !fromEmail) {
    result.waitingForConfiguration = deliveries.length;
    return result;
  }

  for (const delivery of deliveries) {
    const now = new Date().toISOString();
    try {
      const sent = await sendEmail(
        {
          apiKey,
          fromEmail,
          fromName: process.env.PLATFORM_ALERT_FROM_NAME || "Platform Support",
        },
        {
          to: delivery.destination,
          subject: delivery.subject,
          body: delivery.body,
        },
      );
      await admin.from("support_notification_outbox").update({
        status: "sent",
        attempt_count: delivery.attempt_count + 1,
        last_attempt_at: now,
        sent_at: now,
        provider_ref: sent.messageId,
        error_message: null,
      }).eq("id", delivery.id);
      result.sent += 1;
    } catch (error) {
      await admin.from("support_notification_outbox").update({
        status: "failed",
        attempt_count: delivery.attempt_count + 1,
        last_attempt_at: now,
        error_message: error instanceof Error ? error.message : "Support alert delivery failed.",
      }).eq("id", delivery.id);
      result.failed += 1;
    }
  }

  return result;
}

