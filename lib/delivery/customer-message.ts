import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  sendSms,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Delivery of an approved customer message. Hard rules (docs/13):
// - Runs ONLY after a human approved the draft (called from approval
//   resolution, never from the engine).
// - Sends ONLY when the client's Twilio connection is in live mode;
//   otherwise it records an honest dry-run/skip outcome.
// - Every attempt (sent, dry run, skipped, failed) is logged as an outbound
//   integration event tied to the workflow run.

export type DeliveryOutcome = {
  attempted: boolean;
  delivered: boolean;
  detail: string;
};

type ApprovedMessage = {
  approvalId: string;
  partnerId: string;
  clientId: string;
  workflowRunId: string | null;
  channel: string | null;
  to: string | null;
  body: string;
};

export async function deliverApprovedCustomerMessage(
  message: ApprovedMessage,
): Promise<DeliveryOutcome> {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return {
      attempted: false,
      delivered: false,
      detail:
        "Delivery skipped: the server is not configured for delivery (missing service credentials).",
    };
  }

  if (message.channel !== "sms") {
    return {
      attempted: false,
      delivered: false,
      detail:
        "Approved and recorded. Email delivery is not part of the pilot stack yet — send this draft manually if needed.",
    };
  }

  if (!message.to) {
    return {
      attempted: false,
      delivered: false,
      detail:
        "Approved and recorded, but the lead has no phone number on file, so nothing was sent.",
    };
  }

  const { data: connection } = await admin
    .from("integration_connections")
    .select(
      "id, runtime_mode, status, error_count, provider:integration_providers!inner(provider_key)",
    )
    .eq("client_id", message.clientId)
    .eq("partner_id", message.partnerId)
    .in("status", ["connected", "needs_attention"])
    .eq("provider.provider_key", "twilio")
    .limit(1)
    .maybeSingle();

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
      event_type: "sms.customer_message",
      status,
      request_payload: redactAuditValue({
        to: message.to,
        body: message.body,
        approval_id: message.approvalId,
      }),
      response_payload: redactAuditValue(response),
      error_message: errorMessage ?? null,
      redacted: true,
    });
  };

  if (!connection) {
    await logEvent("skipped", {
      note: "No connected Twilio SMS connection for this client.",
    });

    return {
      attempted: false,
      delivered: false,
      detail:
        "Approved and recorded. No Twilio connection is set up for this client, so nothing was sent — connect Twilio in the client's Setup checklist.",
    };
  }

  if (connection.runtime_mode !== "live") {
    await logEvent("dry_run", {
      note: "Twilio connection is not in live mode; message recorded but not sent.",
    });

    return {
      attempted: true,
      delivered: false,
      detail: `Approved and recorded as a dry run — the Twilio connection is in ${connection.runtime_mode.replaceAll("_", " ")} mode. Switch it to live to send for real.`,
    };
  }

  try {
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
      .update({ last_success_at: new Date().toISOString(), status: "connected" })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: true,
      detail: `SMS sent to ${message.to} via Twilio (${outcome.messageSid}).`,
    };
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : "Twilio send failed.";

    await logEvent("failed", {}, detail);

    await admin
      .from("integration_connections")
      .update({
        status: "needs_attention",
        last_failure_at: new Date().toISOString(),
        error_count: (connection.error_count ?? 0) + 1,
        health_summary: `Last SMS send failed: ${detail}`,
      })
      .eq("id", connection.id);

    return {
      attempted: true,
      delivered: false,
      detail: `Approval recorded, but the SMS failed to send: ${detail}`,
    };
  }
}
