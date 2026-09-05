import { cache } from "react";
import { cookies } from "next/headers";

import type { MembershipRole } from "@/lib/permissions/types";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const IMPERSONATION_COOKIE = "northstar_support_context";

export type ImpersonationMode = "read_only" | "sandbox_full";
export type ImpersonationTargetKind = "partner" | "client";

export type ActiveImpersonation = {
  id: string;
  actorUserId: string;
  actorRole: MembershipRole;
  targetKind: ImpersonationTargetKind;
  targetPartnerId: string;
  targetPartnerName: string;
  targetClientId: string | null;
  targetClientName: string | null;
  targetClientAccountKind: "managed_client" | "partner_agency" | null;
  mode: ImpersonationMode;
  reason: string;
  returnPath: string;
  expiresAt: string;
};

export const getActiveImpersonation = cache(
  async (userId: string): Promise<ActiveImpersonation | null> => {
    const cookieStore = await cookies();
    const sessionId = cookieStore.get(IMPERSONATION_COOKIE)?.value;

    if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) {
      return null;
    }

    const admin = createSupabaseAdminClient();
    if (!admin) return null;

    const { data: session, error } = await admin
      .from("support_impersonation_sessions")
      .select(
        "id, actor_user_id, actor_role, target_kind, target_partner_id, target_client_id, mode, reason, return_path, expires_at, ended_at",
      )
      .eq("id", sessionId)
      .eq("actor_user_id", userId)
      .is("ended_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error || !session) return null;

    // A cookie must not preserve authority after the actor is suspended or
    // removed. Recheck the real membership on every request, not the role
    // captured when this support session started.
    const { data: actorMemberships, error: actorError } = await admin
      .from("memberships")
      .select("role, partner_id, client_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .is("client_id", null);
    const authorized = actorMemberships?.some((membership) =>
      membership.partner_id === null
        ? ["platform_owner", "platform_admin", "platform_support"].includes(membership.role)
        : session.target_kind === "client" && membership.partner_id === session.target_partner_id,
    );
    if (actorError || !authorized) return null;

    const [{ data: partner }, clientResult] = await Promise.all([
      admin
        .from("partners")
        .select("id, name, is_test_account")
        .eq("id", session.target_partner_id)
        .maybeSingle(),
      session.target_client_id
        ? admin
            .from("client_businesses")
            .select("id, name, account_kind, is_test_account")
            .eq("id", session.target_client_id)
            .eq("partner_id", session.target_partner_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    if (!partner) return null;
    if (session.target_client_id && !clientResult.data) return null;
    if (session.mode === "sandbox_full" && !(session.target_kind === "partner"
      ? partner.is_test_account : clientResult.data?.is_test_account)) return null;

    return {
      id: session.id,
      actorUserId: session.actor_user_id,
      actorRole: session.actor_role as MembershipRole,
      targetKind: session.target_kind as ImpersonationTargetKind,
      targetPartnerId: session.target_partner_id,
      targetPartnerName: partner.name,
      targetClientId: session.target_client_id,
      targetClientName: clientResult.data?.name ?? null,
      targetClientAccountKind:
        (clientResult.data?.account_kind as
          | "managed_client"
          | "partner_agency"
          | undefined) ?? null,
      mode: session.mode as ImpersonationMode,
      reason: session.reason,
      returnPath: session.return_path,
      expiresAt: session.expires_at,
    };
  },
);
