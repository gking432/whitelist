import { redactAuditValue } from "@/lib/audit/redact";
import { isBlockedDestination } from "@/lib/integrations/providers/outbound-webhook";
import {
  monitoringFingerprint,
  monitoringPath,
  sanitizeMonitoringText,
} from "@/lib/monitoring/sanitize";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type PlatformErrorSource =
  | "server"
  | "browser"
  | "desktop"
  | "voice_stream"
  | "job_worker";

type PlatformErrorInput = {
  source: PlatformErrorSource;
  error: unknown;
  severity?: "warning" | "error" | "fatal";
  routePath?: string | null;
  routeType?: string | null;
  digest?: string | null;
  metadata?: Record<string, unknown>;
};

function errorParts(error: unknown) {
  if (error instanceof Error) {
    return {
      name: sanitizeMonitoringText(error.name, 160) ?? "Error",
      message:
        sanitizeMonitoringText(error.message, 2_000) ?? "Unhandled error",
      stack: sanitizeMonitoringText(error.stack, 8_000),
    };
  }

  return {
    name: "Error",
    message: sanitizeMonitoringText(String(error), 2_000) ?? "Unhandled error",
    stack: null,
  };
}

async function sendAlert(input: {
  id: string;
  source: PlatformErrorSource;
  severity: string;
  message: string;
  routePath: string | null;
  release: string | null;
}) {
  const destination = process.env.PLATFORM_ALERT_WEBHOOK_URL;
  if (!destination || isBlockedDestination(destination)) return;

  try {
    await fetch(destination, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "platform.error_detected",
        occurred_at: new Date().toISOString(),
        data: input,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    // Monitoring must never become another application failure.
  }
}

export async function recordPlatformError(input: PlatformErrorInput) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { recorded: false as const };

  const parts = errorParts(input.error);
  const routePath = monitoringPath(input.routePath);
  const digest = sanitizeMonitoringText(input.digest, 200);
  const release =
    sanitizeMonitoringText(
      process.env.RENDER_GIT_COMMIT ?? process.env.GITHUB_SHA,
      200,
    ) ?? null;
  const fingerprint = monitoringFingerprint({
    source: input.source,
    errorName: parts.name,
    message: parts.message,
    routePath,
    digest,
  });
  const { data, error } = await admin.rpc("record_platform_error", {
    p_fingerprint: fingerprint,
    p_source: input.source,
    p_severity: input.severity ?? "error",
    p_environment: process.env.NODE_ENV ?? "unknown",
    p_release: release,
    p_message: parts.message,
    p_error_name: parts.name,
    p_digest: digest,
    p_route_path: routePath,
    p_route_type: sanitizeMonitoringText(input.routeType, 160),
    p_stack_preview: parts.stack,
    p_metadata: redactAuditValue(input.metadata ?? {}),
  });

  if (error) {
    console.error("Platform error monitoring write failed:", error.message);
    return { recorded: false as const };
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (result?.should_alert) {
    await sendAlert({
      id: String(result.error_id),
      source: input.source,
      severity: input.severity ?? "error",
      message: parts.message,
      routePath,
      release,
    });
  }

  return {
    recorded: true as const,
    id: result?.error_id ? String(result.error_id) : null,
  };
}
