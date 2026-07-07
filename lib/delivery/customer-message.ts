import type { SupabaseClient } from "@supabase/supabase-js";

import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  sendEmail,
  type EmailCredentials,
} from "@/lib/integrations/providers/email";
import {
  sendSms,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Delivery of an approved customer message (SMS via Twilio, email via
// Resend). Hard rules (docs/13):
// - Runs ONLY after a human approved the draft (called from approval
//   resolution, never from the engine).
// - Sends ONLY when the channel's connection is in live mode; otherwise it
//   records an honest dry-run/skip outcome.
// - Every attempt (sent, dry run, skipped, failed) is logged as an outbound
//   integration event tied to the workflow run.

export type DeliveryOutcome = {
  attempted: boolean;
  delivered: boolean;
  detail: string;
  // Explicit machine-readable outcome for durable job recording.
  status: "succeeded" | "dry_run" | "skipped" | "failed";
  // Provider-side reference for the delivered artifact (message SID,
  // calendar event id) when one exists.
  externalRef?: string | null;
};

type ApprovedMessage = {
  approvalId: string;
  partnerId: string;
  clientId: string;
  workflowRunId: string | null;
  channel: string | null;
  to: string | null;
  body: string;
  subject?: string | null;
};

type ChannelConfig = {
  providerKey: string;
  providerLabel: string;
  eventType: string;
  connectHint: string;
};

const CHANNELS: Record<"sms" | "email", ChannelConfig> = {
  sms: {
    providerKey: "twilio",
    providerLabel: "Twilio",
    eventType: "sms.customer_message",
    connectHint: "connect Twilio in the client's Setup checklist",
  },
  email: {
    providerKey: "resend",
    providerLabel: "Resend",
    eventType: "email.customer_message",
    connectHint: "connect Resend Email in the client's Setup checklist",
  },
};

async function findChannelConnection(
  admin: SupabaseClient,
  message: ApprovedMessage,
  providerKey: string,
) {
  const { data } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", message.clientId)
    .eq("partner_id", message.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.provider_key", providerKey)
    .limit(1)
    .maybeSingle();

  return data as {
    id: string;
    runtime_mode: string;
    status: string;
    error_count: number | null;
  } | null;
}

export async function deliverApprovedCustomerMessage(
  message: ApprovedMessage,
): Promise<DeliveryOutcome> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Delivery skipped: the server is not configured for delivery (missing service credentials).",
    };
  }

  if (message.channel !== "sms" && message.channel !== "email") {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail:
        "Approved and recorded. This draft has no deliverable channel — send it manually if needed.",
    };
  }

  if (!message.to) {
    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail: `Approved and recorded, but the lead has no ${
        message.channel === "sms" ? "phone number" : "email address"
      } on file, so nothing was sent.`,
    };
  }

  const channel = CHANNELS[message.channel];
  const connection = await findChannelConnection(
    admin,
    message,
    channel.providerKey,
  );

  const logEvent = async (
    status: "sent" | "dry_run" | "failed" | "skipped",
    response: Record<string, unknown>,
    errorMessage?: string,
  ) => {
    await admin.from("integration_events").insert({
      partner_id: message.partnerId,
      client_id: message.clientId,
      connection_id: connection?.id ?? null,
      workflow_run_id: message.workflowRunId,
      direction: "outbound",
      event_type: channel.eventType,
      status,
      request_payload: redactAuditValue({
        to: message.to,
        body: message.body,
        subject: message.subject ?? null,
        approval_id: message.approvalId,
      }),
      response_payload: redactAuditValue(response),
      error_message: errorMessage ?? null,
      redacted: true,
    });
  };

  if (!connection) {
    await logEvent("skipped", {
      note: `No connected ${channel.providerLabel} connection for this client.`,
    });

    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail: `Approved and recorded. No ${channel.providerLabel} connection is set up for this client, so nothing was sent — ${channel.connectHint}.`,
    };
  }

  if (connection.runtime_mode !== "live") {
    await logEvent("dry_run", {
      note: `${channel.providerLabel} connection is not in live mode; message recorded but not sent.`,
    });

    return {
      attempted: true,
      delivered: false,
      status: "dry_run",
      detail: `Approved and recorded as a dry run — the ${channel.providerLabel} connection is in ${connection.runtime_mode.replaceAll("_", " ")} mode. Switch it to live to send for real.`,
    };
  }

  try {
    if (message.channel === "sms") {
      const credentials = await readProviderCredentials<TwilioCredentials>(
        admin,
        connection.id,
      );

      if (
        !credentials?.accountSid ||
        !credentials.authToken ||
        !credentials.fromNumber
      ) {
        throw new Error("Twilio credentials are incomplete. Reconnect Twilio.");
      }

      const outcome = await sendSms(credentials, message.to, message.body);

      await logEvent("sent", {
        message_sid: outcome.messageSid,
        twilio_status: outcome.status,
      });

      await admin
        .from("integration_connections")
        .update({
          last_success_at: new Date().toISOString(),
          status: "connected",
        })
        .eq("id", connection.id);

      return {
        attempted: true,
        delivered: true,
        status: "succeeded",
      detail: `SMS sent to ${message.to} via Twilio (${outcome.messageSid}).`,
      };
    }

    const credentials = await readProviderCredentials<EmailCredentials>(
      admin,
      connection.id,
    );

    if (!credentials?.apiKey || !credentials.fromEmail) {
      throw new Error("Resend credentials are incomplete. Reconnect Resend.");
    }

    const outcome = await sendEmail(credentials, {
      to: message.to,
      subject: message.subject?.trim() || "A message from your service team",
      body: message.body,
    });

    await logEvent("sent", { message_id: outcome.messageId });

    await admin
      .from("integration_connections")
      .update({
        last_success_at: new Date().toISOString(),
        status: "connected",
      })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: true,
      status: "succeeded",
      detail: `Email sent to ${message.to} via Resend (${outcome.messageId}).`,
    };
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : `${channel.providerLabel} send failed.`;

    await logEvent("failed", {}, detail);

    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
        health_summary: `Last ${message.channel} send failed: ${detail}`,
      })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: false,
      status: "failed",
      detail: `Approval recorded, but the ${message.channel} failed to send: ${detail}`,
    };
  }
}
