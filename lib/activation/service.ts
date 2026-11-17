import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AgentScope } from "@/lib/agents/types";
import {
  getAppUrl,
  getGoogleOAuthClient,
  getMicrosoftOAuthClient,
} from "@/lib/env";
import { isAIConfigured } from "@/lib/ai/provider";
import { generateWidgetKey } from "@/lib/chat/widget";
import { loadPlatformHealth } from "@/lib/ops/platform-health";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import { readProviderCredentials } from "@/lib/integrations/credentials";
import {
  mintWorkspaceAccessToken,
  type WorkspaceCredentials,
} from "@/lib/integrations/providers/workspace-oauth";
import { enqueueInitialConnectorSync } from "@/lib/integrations/connectors/sync-runner";
import { activationStatus, freshCheck, workspacePermissions } from "./rules";
import type {
  ActivationCheck,
  ActivationPlan,
  ActivationSnapshot,
  WorkspaceProvider,
} from "./types";

export const ActivationInput = z
  .object({
    action: z.literal("save"),
    revision: z.number().int().min(0),
    status: z.enum(["active", "paused"]),
    inquiries: z.boolean(),
    bookings: z.boolean(),
    website: z.boolean(),
    email: z.boolean(),
    instagram: z.boolean(),
    sms: z.boolean(),
    workspace_provider: z.enum(["google_workspace", "microsoft_365"]),
    booking_start_hour: z.number().int().min(0).max(23),
    booking_end_hour: z.number().int().min(1).max(24),
    booking_minutes: z.number().int().min(15).max(480),
    booking_weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    timezone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid timezone."),
  })
  .strict()
  .refine((v) => v.inquiries || v.bookings, "Choose at least one assistant.")
  .refine(
    (v) => v.website || v.email || v.instagram || v.sms,
    "Choose a customer channel.",
  )
  .refine(
    (v) =>
      v.booking_end_hour > v.booking_start_hour &&
      v.booking_minutes <= (v.booking_end_hour - v.booking_start_hour) * 60,
    "Appointment length must fit within your booking hours.",
  );

export async function readActivationPlan(
  admin: SupabaseClient,
  scope: AgentScope,
) {
  const { data, error } = await admin
    .from("business_agent_activation")
    .select("*")
    .eq("partner_id", scope.partnerId)
    .eq("client_id", scope.clientId)
    .maybeSingle();
  if (error) throw new Error("Assistant setup could not be loaded.");
  return data as ActivationPlan | null;
}

export async function applyActivation(
  admin: SupabaseClient,
  scope: AgentScope,
  revision: number,
  choices: Record<string, unknown> | null,
) {
  const { error } = await admin.rpc("apply_business_activation", {
    p_partner: scope.partnerId,
    p_client: scope.clientId,
    p_revision: revision,
    p_choices: choices,
    p_widget_key: generateWidgetKey(),
  });
  if (error)
    throw new Error(
      "Setup changed or could not be saved. Refresh and try again.",
    );
  const plan = await readActivationPlan(admin, scope);
  if (
    plan?.status === "active" &&
    plan.workspace_connection_id &&
    (plan.email || plan.bookings)
  ) {
    const connected = await admin
      .from("integration_connections")
      .select("status")
      .eq("id", plan.workspace_connection_id)
      .eq("partner_id", scope.partnerId)
      .eq("client_id", scope.clientId)
      .single()
      .throwOnError();
    if (connected.data.status === "connected")
      await enqueueInitialConnectorSync(admin, {
        ...scope,
        connectionId: plan.workspace_connection_id,
        providerKey: plan.workspace_provider,
      });
  }
  return plan;
}

/** Read-only provider calls. A send grant is checked without sending a test email. */
export async function probeWorkspace(
  provider: WorkspaceProvider,
  credentials: WorkspaceCredentials,
) {
  const granted = workspacePermissions(provider, credentials.scope ?? "");
  const token = await mintWorkspaceAccessToken(provider, credentials);
  const get = async (url: string, init: RequestInit = {}) => {
    const response = await fetch(url, {
      ...init,
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new Error(
        "Access could not be verified. Reconnect the account and approve the requested permissions.",
      );
    return response.json();
  };
  const account = await get(
    provider === "google_workspace"
      ? "https://www.googleapis.com/oauth2/v2/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName",
  );
  let email = false,
    calendar = false;
  // Independently prove the selected capabilities, not merely the user-info endpoint.
  if (granted.email) {
    await get(
      provider === "google_workspace"
        ? "https://gmail.googleapis.com/gmail/v1/users/me/profile"
        : "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=1&$select=id",
    );
    email = true;
  }
  if (granted.calendar) {
    if (provider === "google_workspace") {
      const busy = await get(
        "https://www.googleapis.com/calendar/v3/freeBusy",
        {
          method: "POST",
          body: JSON.stringify({
            timeMin: new Date().toISOString(),
            timeMax: new Date(Date.now() + 86400000).toISOString(),
            items: [{ id: "primary" }],
          }),
        },
      );
      if (!busy.calendars?.primary || busy.calendars.primary.errors?.length)
        throw new Error("Calendar availability access needs attention.");
    } else {
      await get(
        `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${encodeURIComponent(new Date().toISOString())}&endDateTime=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&$top=1&$select=id`,
      );
    }
    calendar = true;
  }
  return {
    email,
    calendar,
    accountId: String(account.id ?? ""),
    accountName: String(
      account.email ??
        account.mail ??
        account.userPrincipalName ??
        "Connected account",
    ),
  };
}

export async function recheckWorkspace(
  admin: SupabaseClient,
  scope: AgentScope,
) {
  const plan = await readActivationPlan(admin, scope);
  if (!plan?.workspace_connection_id)
    throw new Error("Connect your Google or Microsoft account first.");
  const credentials = await readProviderCredentials<WorkspaceCredentials>(
    admin,
    plan.workspace_connection_id,
  );
  if (!credentials) throw new Error("Reconnect the account to restore access.");
  let check: Awaited<ReturnType<typeof probeWorkspace>> | null = null;
  try {
    check = await probeWorkspace(plan.workspace_provider, credentials);
  } finally {
    const { error } = await admin.rpc("record_activation_workspace_check", {
      p_partner: scope.partnerId,
      p_client: scope.clientId,
      p_revision: plan.revision,
      p_connection: plan.workspace_connection_id,
      p_email: check?.email ?? false,
      p_calendar: check?.calendar ?? false,
    });
    if (error)
      throw new Error("Setup changed. Check the current connection again.");
  }
  if (
    plan.status === "active" &&
    check &&
    (!plan.email || check.email) &&
    (!plan.bookings || check.calendar)
  ) {
    await enqueueInitialConnectorSync(admin, {
      ...scope,
      connectionId: plan.workspace_connection_id,
      providerKey: plan.workspace_provider,
    });
  }
  return check;
}

export async function readActivation(
  admin: SupabaseClient,
  scope: AgentScope,
  canWrite: boolean,
): Promise<ActivationSnapshot> {
  const [plan, connections, profile, health, team, knowledge, inboxSync] =
    await Promise.all([
      readActivationPlan(admin, scope),
      admin
        .from("integration_connections")
        .select(
          "id,status,credential_status,runtime_mode,config,external_account_name,provider:integration_providers!inner(provider_key)",
        )
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .order("created_at"),
      admin
        .from("business_workspace_profiles")
        .select("profile")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .maybeSingle(),
      loadPlatformHealth(admin),
      admin
        .from("agent_team_settings")
        .select("status,conversations_enabled,scheduling_enabled")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .maybeSingle(),
      getKnowledgeProfile(admin, scope.clientId),
      admin
        .from("integration_sync_states")
        .select("connection_id,status,last_completed_at")
        .eq("partner_id", scope.partnerId)
        .eq("client_id", scope.clientId)
        .eq("stream_key", "message"),
    ]);
  if (connections.error || profile.error || team.error || inboxSync.error)
    throw new Error("Connection checks are unavailable.");
  const business = profile.data?.profile ?? {};
  const rows = (connections.data ?? []).map((row) => ({
    ...row,
    key: (row.provider as unknown as { provider_key: string }).provider_key,
    config: row.config as Record<string, unknown>,
  }));
  const workspace = rows.find(
    (row) => row.id === plan?.workspace_connection_id,
  );
  const website = rows.find((row) => row.key === "northstar_web_chat");
  const verified =
    workspace?.status === "connected" &&
    workspace.credential_status === "configured" &&
    workspace.runtime_mode === "live" &&
    freshCheck(workspace.config.activation_checked_at);
  const checks: ActivationCheck[] = [];
  const inboxState = inboxSync.data?.find(
    (s) => s.connection_id === plan?.workspace_connection_id,
  );
  const check = (
    key: string,
    label: string,
    ready: boolean,
    good: string,
    bad: string,
  ) => checks.push({ key, label, ready, detail: ready ? good : bad });
  if (plan) {
    check(
      "knowledge",
      "Business details",
      !!knowledge?.business_description?.trim() &&
        !!knowledge?.services_offered?.trim(),
      "Your team has your business description and services.",
      "Add your business description and services in Business settings.",
    );
    check(
      "ai",
      "Assistant service",
      isAIConfigured(),
      "Assistant service configured.",
      "Your operator needs to finish setting up the assistant service.",
    );
    check(
      "worker",
      "Background processing",
      health.services.jobs.status === "ready",
      "The background service is reporting healthy.",
      "Your operator needs to restore background processing.",
    );
    check(
      "team",
      "Shared customer team",
      team.data?.status === "active" &&
        team.data.conversations_enabled === true &&
        (!plan.bookings || team.data.scheduling_enabled === true),
      "Inquiry, care and booking assistants use the same customer records.",
      "The team is paused or its settings changed. Save this setup to restore it.",
    );
    if (plan.email || plan.bookings)
      check(
        "account",
        "Business account",
        !!workspace &&
          workspace.status === "connected" &&
          workspace.credential_status === "configured",
        "Account authorized.",
        "Connect Google or Microsoft in the account section.",
      );
    if (plan.email) {
      check(
        "email",
        "Email access",
        !!verified && workspace?.config.activation_mail_verified === true,
        "Inbox access and approved-reply permission checked. New text emails enter the team; attachments and automated mail stay in your inbox.",
        "Connect or recheck inbox access. Replies start with new mail after activation.",
      );
      check(
        "sync",
        "Inbox monitoring",
        health.services.connector_worker.status === "ready" &&
          !!inboxState &&
          inboxState.status !== "paused" &&
          inboxState.status !== "error" &&
          freshCheck(inboxState.last_completed_at, Date.now(), 45 * 60 * 1000),
        "Your inbox has synced recently and the connection worker is healthy.",
        !inboxState?.last_completed_at
          ? "Waiting for the first inbox sync. If this persists, your operator needs to check inbox monitoring."
          : "Inbox sync is paused, stale or needs operator attention.",
      );
    }
    if (plan.bookings)
      check(
        "calendar",
        "Calendar access",
        !!verified && workspace?.config.activation_calendar_verified === true,
        "Availability access and booking permission checked. You approve bookings.",
        "Connect or recheck your calendar before appointments can be offered.",
      );
    if (plan.website)
      check(
        "website",
        "Website chat",
        !!website &&
          website.status === "connected" &&
          website.runtime_mode === "live",
        "Chat link is ready. Add it to your website using the code above.",
        "Save this setup to prepare your chat link.",
      );
    for (const [enabled, key, label] of [
      [plan.instagram, "instagram_messaging", "Instagram"],
      [plan.sms, "twilio", "Text messages"],
    ] as const) {
      if (!enabled) continue;
      const row = rows.find((r) => r.key === key);
      let delivered = false;
      if (
        row?.status === "connected" &&
        row.runtime_mode === "live" &&
        row.credential_status === "configured"
      ) {
        const receipts = await admin
          .from("business_conversation_messages")
          .select(
            "direction,status,provider_ref,conversation:business_conversations!inner(connection_id)",
          )
          .eq("partner_id", scope.partnerId)
          .eq("client_id", scope.clientId)
          .eq("conversation.connection_id", row.id)
          .gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString())
          .in("status", ["received", "sent"])
          .limit(500);
        if (receipts.error)
          throw new Error("Channel delivery checks are unavailable.");
        delivered =
          !!receipts.data?.some(
            (r) => r.direction === "inbound" && r.status === "received",
          ) &&
          !!receipts.data?.some(
            (r) =>
              r.direction === "outbound" &&
              r.status === "sent" &&
              r.provider_ref,
          );
      }
      // Account credentials alone do not establish working inbound delivery.
      check(
        key,
        label,
        delivered,
        "Incoming messages and approved outgoing delivery recorded in the last 30 days.",
        row?.status === "connected"
          ? "Account connected. Your operator must verify incoming and approved outgoing messages before launch."
          : "Operator-assisted setup required. Request setup below; no developer credentials needed from you.",
      );
    }
  }
  const widgetKey = website?.config.widget_public_key;
  const widgetUrl =
    typeof widgetKey === "string" && /^wk_[A-Za-z0-9_-]{20,}$/.test(widgetKey)
      ? `${getAppUrl()}/widget/${widgetKey}`
      : null;
  return {
    plan,
    canWrite,
    checks,
    status: activationStatus(plan, checks),
    recommendedBookings:
      /salon|fitness|coach|trainer|landscap|service|appointment|health|consult/i.test(
        `${business.industry ?? ""} ${business.services ?? ""}`,
      ),
    accounts: [
      {
        provider: "google_workspace",
        name: "Google",
        available: !!getGoogleOAuthClient(),
        connected: rows.some(
          (r) => r.key === "google_workspace" && r.status === "connected",
        ),
      },
      {
        provider: "microsoft_365",
        name: "Microsoft",
        available: !!getMicrosoftOAuthClient(),
        connected: rows.some(
          (r) => r.key === "microsoft_365" && r.status === "connected",
        ),
      },
    ],
    widgetUrl,
    widgetSnippet: widgetUrl
      ? `<iframe src="${widgetUrl.replaceAll('"', "&quot;")}" title="Chat with our team" width="380" height="600" style="max-width:100%;border:0;border-radius:16px"></iframe>`
      : null,
    workspaceAccount: workspace?.external_account_name ?? null,
  };
}

export async function maintainActivationChecks(
  admin: SupabaseClient,
  limit = 3,
) {
  const { data, error } = await admin.rpc("due_activation_checks", {
    p_limit: limit,
  });
  if (error) throw new Error("Connection checks could not be scheduled.");
  let checked = 0,
    attention = 0;
  for (const plan of (data ?? []) as ActivationPlan[]) {
    try {
      await recheckWorkspace(admin, {
        partnerId: plan.partner_id,
        clientId: plan.client_id,
      });
      checked++;
    } catch {
      attention++;
    }
  }
  await admin
    .from("business_activation_oauth_attempts")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .throwOnError();
  return { checked, attention };
}
