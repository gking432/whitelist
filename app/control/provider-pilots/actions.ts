"use server";

import { revalidatePath } from "next/cache";

import { recordAuditEvent } from "@/lib/audit/audit";
import { getAuthState } from "@/lib/auth/session";
import { providerPilotReadiness } from "@/lib/control/provider-pilot";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function text(formData: FormData, key: string, maximum: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maximum);
}

async function ownerContext() {
  const auth = await getAuthState();
  if (!auth.user) return null;
  const access = await requirePlatformRole(auth.user.id, [
    "platform_owner",
    "platform_admin",
  ]);
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  return { userId: auth.user.id, access, admin };
}

export async function startProviderPilot(formData: FormData) {
  const context = await ownerContext();
  if (!context) return;
  const connectionId = text(formData, "connection_id", 80);
  if (!connectionId) return;

  const { data: connection } = await context.admin
    .from("integration_connections")
    .select(
      "id, provider_id, client:client_businesses!inner(account_kind, is_test_account), provider:integration_providers!inner(display_name)",
    )
    .eq("id", connectionId)
    .maybeSingle();
  const client = connection?.client as unknown as {
    account_kind: string;
    is_test_account: boolean;
  } | null;
  if (
    !connection ||
    client?.account_kind !== "managed_client" ||
    client.is_test_account
  ) {
    throw new Error("Provider pilots require a real managed client account.");
  }

  const { data: existing } = await context.admin
    .from("provider_live_pilots")
    .select("id")
    .eq("connection_id", connection.id)
    .in("status", ["draft", "passed"])
    .maybeSingle();
  if (existing) return;

  const { data: pilot, error } = await context.admin
    .from("provider_live_pilots")
    .insert({
      provider_id: connection.provider_id,
      connection_id: connection.id,
      status: "draft",
      created_by: context.userId,
    })
    .select("id")
    .single();
  if (error || !pilot) {
    throw new Error(error?.message ?? "Provider pilot could not be started.");
  }

  const provider = connection.provider as unknown as {
    display_name: string;
  } | null;
  await recordAuditEvent({
    actor: context.access,
    action: "provider_pilot.started",
    targetType: "provider_live_pilot",
    targetId: pilot.id,
    summary: `Started real-account pilot for ${provider?.display_name ?? "provider"}.`,
    metadata: {
      provider_id: connection.provider_id,
      connection_id: connection.id,
    },
  });
  revalidatePath("/control/provider-pilots");
}

export async function saveProviderPilot(formData: FormData) {
  const context = await ownerContext();
  if (!context) return;
  const connectionId = text(formData, "connection_id", 80);
  if (!connectionId) return;

  const { data: connection } = await context.admin
    .from("integration_connections")
    .select(
      "id, provider_id, partner_id, client_id, status, credential_status, runtime_mode, provider:integration_providers!inner(display_name, supports_inbound, supports_outbound)",
    )
    .eq("id", connectionId)
    .maybeSingle();
  if (!connection) return;

  const { data: activePilot } = await context.admin
    .from("provider_live_pilots")
    .select("id, started_at")
    .eq("connection_id", connection.id)
    .eq("status", "draft")
    .maybeSingle();
  if (!activePilot) {
    throw new Error("Start this provider pilot before recording evidence.");
  }

  const latestEvent = async (direction: "inbound" | "outbound") => {
    const { data } = await context.admin
      .from("integration_events")
      .select("id")
      .eq("connection_id", connection.id)
      .eq("direction", direction)
      .eq("status", "processed")
      .gte("created_at", activePilot.started_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  };
  const [inboundEventId, outboundEventId] = await Promise.all([
    latestEvent("inbound"),
    latestEvent("outbound"),
  ]);
  const provider = connection.provider as unknown as {
    display_name: string;
    supports_inbound: boolean;
    supports_outbound: boolean;
  };
  const evidence = {
    read_evidence: text(formData, "read_evidence", 4000),
    retry_evidence: text(formData, "retry_evidence", 4000),
    revocation_evidence: text(formData, "revocation_evidence", 4000),
    notes: text(formData, "notes", 8000),
  };
  const { data: existing } = await context.admin
    .from("provider_live_pilots")
    .select("id, status")
    .eq("connection_id", connection.id)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!existing) {
    throw new Error("Start this provider pilot before recording evidence.");
  }

  const payload = {
    provider_id: connection.provider_id,
    connection_id: connection.id,
    status: "draft",
    inbound_event_id: inboundEventId,
    outbound_event_id: outboundEventId,
    ...evidence,
    created_by: context.userId,
    reviewed_by: null,
    passed_at: null,
    revoked_at: null,
    revocation_reason: null,
  };
  const pilotQuery = context.admin
    .from("provider_live_pilots")
    .update({ ...payload, created_by: undefined })
    .eq("id", existing.id);
  const { data: pilot, error } = await pilotQuery.select("id").single();
  if (error || !pilot) {
    throw new Error(error?.message ?? "Provider pilot could not be saved.");
  }

  const readiness = providerPilotReadiness({
    connectionStatus: connection.status,
    credentialStatus: connection.credential_status,
    runtimeMode: connection.runtime_mode,
    supportsInbound: provider.supports_inbound,
    supportsOutbound: provider.supports_outbound,
    inboundEventId,
    outboundEventId,
    readEvidence: evidence.read_evidence,
    retryEvidence: evidence.retry_evidence,
    revocationEvidence: evidence.revocation_evidence,
  });
  await recordAuditEvent({
    actor: context.access,
    action: "provider_pilot.evidence_saved",
    targetType: "provider_live_pilot",
    targetId: pilot.id,
    summary: `Saved real-account pilot evidence for ${provider.display_name}.`,
    metadata: {
      provider_id: connection.provider_id,
      connection_id: connection.id,
      ready: readiness.ready,
      proof_status: Object.fromEntries(
        readiness.proofs.map((proof) => [proof.key, proof.complete]),
      ),
    },
  });
  revalidatePath("/control/provider-pilots");
}

export async function promoteProviderPilot(formData: FormData) {
  const context = await ownerContext();
  if (!context) return;
  const pilotId = text(formData, "pilot_id", 80);
  const { data: pilot } = await context.admin
    .from("provider_live_pilots")
    .select(
      "id, provider_id, connection_id, status, provider:integration_providers(display_name)",
    )
    .eq("id", pilotId)
    .maybeSingle();
  if (!pilot || pilot.status === "passed") return;

  const { data: promoted, error } = await context.admin.rpc(
    "promote_provider_live_pilot",
    { p_pilot_id: pilot.id, p_actor_id: context.userId },
  );
  if (error || !promoted) {
    throw new Error(
      error?.message ?? "All required live-account evidence must pass first.",
    );
  }
  const provider = pilot.provider as unknown as { display_name?: string } | null;
  await recordAuditEvent({
    actor: context.access,
    action: "provider_pilot.promoted",
    targetType: "integration_provider",
    targetId: pilot.provider_id,
    summary: `${provider?.display_name ?? "Provider"} promoted to live verified.`,
    metadata: { pilot_id: pilot.id, connection_id: pilot.connection_id },
  });
  revalidatePath("/control/provider-pilots");
  revalidatePath("/partner/integrations");
}

export async function revokeProviderPilot(formData: FormData) {
  const context = await ownerContext();
  if (!context) return;
  const pilotId = text(formData, "pilot_id", 80);
  const reason = text(formData, "reason", 2000);
  const { data: pilot } = await context.admin
    .from("provider_live_pilots")
    .select(
      "id, provider_id, connection_id, status, provider:integration_providers(display_name)",
    )
    .eq("id", pilotId)
    .maybeSingle();
  if (!pilot || pilot.status !== "passed") return;

  const { data: revoked, error } = await context.admin.rpc(
    "revoke_provider_live_pilot",
    {
      p_pilot_id: pilot.id,
      p_actor_id: context.userId,
      p_reason: reason,
    },
  );
  if (error || !revoked) {
    throw new Error(error?.message ?? "A specific rollback reason is required.");
  }
  const provider = pilot.provider as unknown as { display_name?: string } | null;
  await recordAuditEvent({
    actor: context.access,
    action: "provider_pilot.revoked",
    targetType: "integration_provider",
    targetId: pilot.provider_id,
    summary: `${provider?.display_name ?? "Provider"} live verification revoked.`,
    metadata: {
      pilot_id: pilot.id,
      connection_id: pilot.connection_id,
      reason,
    },
  });
  revalidatePath("/control/provider-pilots");
  revalidatePath("/partner/integrations");
}
