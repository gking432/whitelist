import { readEffectiveAuthority } from "@/lib/agents/authority";
import { ActionSuppressedError, runActionPreflight, type ActionPreflight } from "@/lib/jobs/action-preflight";

import { redactAuditValue } from "@/lib/audit/redact";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  sendEmail,
  type EmailCredentials,
} from "@/lib/integrations/providers/email";
import { sendGoogleWorkspaceEmail } from "@/lib/integrations/providers/google-workspace";
import { sendMicrosoft365Email } from "@/lib/integrations/providers/microsoft-365";
import type { WorkspaceCredentials } from "@/lib/integrations/providers/workspace-oauth";
import {
  sendSms,
  type TwilioCredentials,
} from "@/lib/integrations/providers/twilio";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadDeliveryAccount } from "./channel-selection.ts";

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
  status:
    | "succeeded"
    | "dry_run"
    | "skipped"
    | "failed"
    | "uncertain"
    | "provider_pending";
  // Provider-side reference for the delivered artifact (message SID,
  // calendar event id) when one exists.
  externalRef?: string | null;
  calendarMutationReceipt?: Record<string, unknown>;
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
  connectionId?: string | null;
  authorityRevision?: number;
  beforeSend?: ActionPreflight;
};

type ChannelConfig = {
  providerKeys: string[];
  providerLabel: string;
  eventType: string;
  connectHint: string;
};

const CHANNELS: Record<"sms" | "email", ChannelConfig> = {
  sms: {
    providerKeys: ["twilio"],
    providerLabel: "Twilio",
    eventType: "sms.customer_message",
    connectHint: "connect Twilio in the client's Setup checklist",
  },
  email: {
    providerKeys: ["google_workspace", "microsoft_365", "resend"],
    providerLabel: "business email",
    eventType: "email.customer_message",
    connectHint:
      "connect Google Workspace, Microsoft 365, or Resend in the client's Setup checklist",
  },
};

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
  const selection = await loadDeliveryAccount(admin, { partnerId: message.partnerId, clientId: message.clientId,
    channel: message.channel, connectionId: message.connectionId });
  const connection = selection.connection;

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
      note: selection.reason,
    });

    return {
      attempted: false,
      delivered: false,
      status: "skipped",
      detail: selection.reason,
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

  const currentAuthority = async () => readEffectiveAuthority(admin, {
    partnerId: message.partnerId, clientId: message.clientId,
  }, message.channel as "email" | "sms", {
    phase: "execute", approved: true, connectionId: connection.id,
    expectedRevision: message.authorityRevision,
  });
  const authority = await currentAuthority();
  if (!authority.allowed) return {
    attempted: false, delivered: false, status: "skipped", detail: authority.reason,
  };
  const preflight = async () => {
    const latest = await currentAuthority();
    if (!latest.allowed) throw new ActionSuppressedError(latest.reason);
    await runActionPreflight(message.beforeSend);
  };
  let providerAttempted = false;
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

      const latest = await currentAuthority();
      if (!latest.allowed) return { attempted: false, delivered: false, status: "skipped", detail: latest.reason };
      await preflight();
      providerAttempted = true;
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
        externalRef: outcome.messageSid,
        detail: `SMS sent to ${message.to} via Twilio (${outcome.messageSid}).`,
      };
    }

    const providerKey = connection.provider?.provider_key ?? "resend";
    const credentials = await readProviderCredentials<
      EmailCredentials & WorkspaceCredentials
    >(admin, connection.id);
    if (!credentials)
      throw new Error(
        "Email authorization is incomplete. Reconnect the business email account.",
      );

    const emailInput = {
      to: message.to,
      subject: message.subject?.trim() || "A message from your service team",
      body: message.body,
      idempotencyKey: message.approvalId,
    };
    const latest = await currentAuthority();
    if (!latest.allowed) return { attempted: false, delivered: false, status: "skipped", detail: latest.reason };
    providerAttempted = true;
    const outcome =
      providerKey === "google_workspace"
        ? await sendGoogleWorkspaceEmail(credentials, emailInput, preflight)
        : providerKey === "microsoft_365"
          ? await sendMicrosoft365Email(credentials, emailInput, preflight)
          : credentials.apiKey && credentials.fromEmail
            ? await (async () => { await preflight(); return sendEmail(credentials, emailInput); })()
            : (() => {
                throw new Error(
                  "Resend credentials are incomplete. Reconnect Resend.",
                );
              })();

    await logEvent("sent", { message_id: outcome.messageId });

    await admin
      .from("integration_connections")
      .update({
        last_success_at: new Date().toISOString(),
        status: "connected",
      })
      .eq("id", connection.id);

    if (providerKey === "microsoft_365") return {
      attempted: true, delivered: false, status: "provider_pending", externalRef: null,
      detail: "Microsoft accepted the approved email for processing. Delivery is not confirmed; check Sent Items before any resend.",
    };
    if (!outcome.messageId) return {
      attempted: true, delivered: false, status: "uncertain", externalRef: null,
      detail: "The provider did not return a message receipt. Check the inbox before any resend.",
    };
    return {
      attempted: true,
      delivered: true,
      status: "succeeded",
      externalRef: outcome.messageId,
      detail: `Email sent to ${message.to} through the connected business email account (${outcome.messageId}).`,
    };
  } catch (error) {
    if (error instanceof ActionSuppressedError)
      return { attempted: false, delivered: false, status: "skipped", detail: error.message };
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
      status: providerAttempted ? "uncertain" : "failed",
      detail: providerAttempted
        ? "The provider result is uncertain. Check the provider before resending; automatic retry is disabled."
        : `Approval recorded, but the ${message.channel} failed to send: ${detail}`,
    };
  }
}
