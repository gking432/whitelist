"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getAuthState } from "@/lib/auth/session";
import { toSafeNextPath } from "@/lib/auth/redirects";
import {
  getActiveImpersonation,
  IMPERSONATION_COOKIE,
  type ImpersonationMode,
  type ImpersonationTargetKind,
} from "@/lib/impersonation/session";
import {
  isAccessError,
  requireClientWorkspaceAccess,
  requirePlatformRole,
} from "@/lib/permissions/access";
import { PARTNER_ROLES } from "@/lib/permissions/roles";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

async function setSessionCookie(sessionId: string, expiresAt: string) {
  const cookieStore = await cookies();
  cookieStore.set(IMPERSONATION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

async function replaceActiveSession(userId: string) {
  const active = await getActiveImpersonation(userId);
  const admin = createSupabaseAdminClient();

  if (active && admin) {
    await admin
      .from("support_impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", active.id)
      .eq("actor_user_id", userId);
  }

  return active;
}

async function createSession(input: {
  actor: AccessContext;
  targetKind: ImpersonationTargetKind;
  targetPartnerId: string;
  targetClientId?: string | null;
  mode: ImpersonationMode;
  reason: string;
  returnPath: string;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");

  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("support_impersonation_sessions")
    .insert({
      actor_user_id: input.actor.userId,
      actor_role: input.actor.role,
      target_kind: input.targetKind,
      target_partner_id: input.targetPartnerId,
      target_client_id: input.targetClientId ?? null,
      mode: input.mode,
      reason: input.reason,
      return_path: toSafeNextPath(input.returnPath),
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error("The support view could not be started.");
  }

  await setSessionCookie(data.id, expiresAt);
}

export type StartPlatformImpersonationInput = {
  targetKind: ImpersonationTargetKind;
  targetId: string;
  requestedMode: ImpersonationMode;
  destination?: string;
  returnPath?: string;
};

export async function startPlatformImpersonation(
  input: StartPlatformImpersonationInput,
  _formData: FormData,
) {
  const authState = await getAuthState();
  if (!authState.user) redirect("/login?next=/control");

  const access = await requirePlatformRole(authState.user.id);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("The data service is unavailable.");

  let targetPartnerId: string;
  let targetClientId: string | null = null;
  let isTestAccount = false;

  if (input.targetKind === "partner") {
    const { data } = await admin
      .from("partners")
      .select("id, is_test_account")
      .eq("id", input.targetId)
      .maybeSingle();

    if (!data) throw new Error("Partner not found.");
    targetPartnerId = data.id;
    isTestAccount = data.is_test_account;
  } else {
    const { data } = await admin
      .from("client_businesses")
      .select("id, partner_id, is_test_account")
      .eq("id", input.targetId)
      .maybeSingle();

    if (!data) throw new Error("Client not found.");
    targetPartnerId = data.partner_id;
    targetClientId = data.id;
    isTestAccount = data.is_test_account;
  }

  const mode =
    input.requestedMode === "sandbox_full" && isTestAccount
      ? "sandbox_full"
      : "read_only";
  const defaultDestination = input.targetKind === "partner" ? "/partner" : "/client";
  const requestedDestination = toSafeNextPath(
    input.destination ?? defaultDestination,
  );
  const destination = requestedDestination.startsWith(
    input.targetKind === "partner" ? "/partner" : "/client",
  )
    ? requestedDestination
    : defaultDestination;

  await replaceActiveSession(authState.user.id);
  await createSession({
    actor: access,
    targetKind: input.targetKind,
    targetPartnerId,
    targetClientId,
    mode,
    reason:
      mode === "sandbox_full"
        ? "Internal test-account walkthrough"
        : "Internal support review",
    returnPath: toSafeNextPath(input.returnPath ?? "/control"),
  });

  redirect(destination);
}

export async function startClientSupportView(
  clientId: string,
  requestedMode: ImpersonationMode,
  _formData: FormData,
) {
  const authState = await getAuthState();
  if (!authState.user) redirect("/login?next=/partner/clients");

  let access: AccessContext;
  let platformActor = false;

  try {
    access = await requirePlatformRole(authState.user.id);
    platformActor = true;
  } catch (error) {
    if (!isAccessError(error) || error.code !== "ACCESS_DENIED") throw error;
    access = await requireClientWorkspaceAccess(
      authState.user.id,
      clientId,
      PARTNER_ROLES,
    );
  }

  const admin = createSupabaseAdminClient();
  if (!admin || !access.partnerId) throw new Error("The data service is unavailable.");

  const { data: client } = await admin
    .from("client_businesses")
    .select("id, partner_id, is_test_account, crm_operating_mode")
    .eq("id", clientId)
    .eq("partner_id", access.partnerId)
    .maybeSingle();

  if (!client) throw new Error("Client not found.");

  const previous = await replaceActiveSession(authState.user.id);
  const mode =
    requestedMode === "sandbox_full" && client.is_test_account
      ? "sandbox_full"
      : "read_only";
  const returnPath = platformActor
    ? "/control"
    : previous?.returnPath ?? `/partner/clients/${clientId}`;

  await createSession({
    actor: access,
    targetKind: "client",
    targetPartnerId: client.partner_id,
    targetClientId: client.id,
    mode,
    reason:
      mode === "sandbox_full"
        ? "Test client walkthrough"
        : "Partner client-support review",
    returnPath,
  });

  const internalCrm = ["primary_crm", "mirror", "assist"].includes(
    client.crm_operating_mode,
  );
  redirect(internalCrm ? "/client/crm" : "/client");
}

export async function stopImpersonation() {
  const authState = await getAuthState();
  const cookieStore = await cookies();
  const active = authState.user
    ? await getActiveImpersonation(authState.user.id)
    : null;
  const admin = createSupabaseAdminClient();

  if (active && admin) {
    await admin
      .from("support_impersonation_sessions")
      .update({ ended_at: new Date().toISOString() })
      .eq("id", active.id)
      .eq("actor_user_id", active.actorUserId);
  }

  cookieStore.delete(IMPERSONATION_COOKIE);
  redirect(active?.returnPath ?? "/");
}
