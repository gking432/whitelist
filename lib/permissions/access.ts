import { createSupabaseServerClient } from "@/lib/supabase/server";
import type {
  AccessContext,
  ClientRole,
  MembershipRole,
  PartnerRole,
  PlatformRole,
} from "@/lib/permissions/types";
import {
  buildAccessContext,
  CLIENT_ROLES,
  PARTNER_ROLES,
  PLATFORM_ROLES,
} from "@/lib/permissions/roles";

type MembershipRecord = {
  id: string;
  user_id: string;
  partner_id: string | null;
  client_id: string | null;
  role: MembershipRole;
  status: string;
};

type ClientScopeRecord = {
  id: string;
  partner_id: string;
  client_portal_enabled: boolean;
  partner_can_edit_client_data: boolean;
};

type AccessErrorCode =
  | "SUPABASE_NOT_CONFIGURED"
  | "ACCESS_DENIED"
  | "ACCESS_LOOKUP_FAILED";

export class AccessError extends Error {
  code: AccessErrorCode;
  status: number;

  constructor(message: string, code: AccessErrorCode, status = 403) {
    super(message);
    this.name = "AccessError";
    this.code = code;
    this.status = status;
  }
}

export function isAccessError(error: unknown): error is AccessError {
  return error instanceof AccessError;
}

function requireNonEmptyRoles<T extends MembershipRole>(
  roles: readonly T[],
): readonly T[] {
  if (roles.length === 0) {
    throw new AccessError("At least one role is required.", "ACCESS_DENIED");
  }

  return roles;
}

async function getSupabaseOrThrow() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new AccessError(
      "Supabase is not configured for this environment.",
      "SUPABASE_NOT_CONFIGURED",
      500,
    );
  }

  return supabase;
}

function denied(message = "You do not have access to this resource."): never {
  throw new AccessError(message, "ACCESS_DENIED", 403);
}

function lookupFailed(message: string): never {
  throw new AccessError(message, "ACCESS_LOOKUP_FAILED", 500);
}

async function fetchClientScope(
  clientId: string,
): Promise<ClientScopeRecord> {
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("client_businesses")
    .select("id, partner_id, client_portal_enabled, partner_can_edit_client_data")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    lookupFailed(error.message);
  }

  if (!data) {
    denied("Client business not found or inaccessible.");
  }

  return data as ClientScopeRecord;
}

function toAccessContext(
  membership: MembershipRecord,
  clientScope?: Partial<ClientScopeRecord>,
): AccessContext {
  return buildAccessContext({
    userId: membership.user_id,
    role: membership.role,
    membershipId: membership.id,
    partnerId: membership.partner_id ?? clientScope?.partner_id,
    clientId: membership.client_id ?? clientScope?.id,
    clientPortalEnabled: clientScope?.client_portal_enabled,
    partnerCanEditClientData: clientScope?.partner_can_edit_client_data,
  });
}

export async function requirePlatformRole(
  userId: string,
  allowedRoles: readonly PlatformRole[] = PLATFORM_ROLES,
): Promise<AccessContext> {
  const roles = requireNonEmptyRoles(allowedRoles);
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, partner_id, client_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .is("partner_id", null)
    .is("client_id", null)
    .in("role", [...roles])
    .maybeSingle();

  if (error) {
    lookupFailed(error.message);
  }

  if (!data) {
    denied("Platform role required.");
  }

  return toAccessContext(data as MembershipRecord);
}

export async function requirePartnerAccess(
  userId: string,
  partnerId: string,
  allowedRoles: readonly PartnerRole[] = PARTNER_ROLES,
): Promise<AccessContext> {
  const roles = requireNonEmptyRoles(allowedRoles);
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, partner_id, client_id, role, status")
    .eq("user_id", userId)
    .eq("partner_id", partnerId)
    .is("client_id", null)
    .eq("status", "active")
    .in("role", [...roles])
    .maybeSingle();

  if (error) {
    lookupFailed(error.message);
  }

  if (!data) {
    denied("Partner access required.");
  }

  return toAccessContext(data as MembershipRecord);
}

export async function requirePrimaryPartnerAccess(
  userId: string,
  allowedRoles: readonly PartnerRole[] = PARTNER_ROLES,
): Promise<AccessContext> {
  const roles = requireNonEmptyRoles(allowedRoles);
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, partner_id, client_id, role, status")
    .eq("user_id", userId)
    .eq("status", "active")
    .not("partner_id", "is", null)
    .is("client_id", null)
    .in("role", [...roles])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    lookupFailed(error.message);
  }

  if (!data) {
    denied("Partner access required.");
  }

  return toAccessContext(data as MembershipRecord);
}

export async function requireClientAccess(
  userId: string,
  clientId: string,
  allowedRoles: readonly ClientRole[] = CLIENT_ROLES,
): Promise<AccessContext> {
  const roles = requireNonEmptyRoles(allowedRoles);
  const clientScope = await fetchClientScope(clientId);
  const supabase = await getSupabaseOrThrow();
  const { data, error } = await supabase
    .from("memberships")
    .select("id, user_id, partner_id, client_id, role, status")
    .eq("user_id", userId)
    .eq("partner_id", clientScope.partner_id)
    .eq("client_id", clientId)
    .eq("status", "active")
    .in("role", [...roles])
    .maybeSingle();

  if (error) {
    lookupFailed(error.message);
  }

  if (!data || !clientScope.client_portal_enabled) {
    denied("Client access required.");
  }

  return toAccessContext(data as MembershipRecord, clientScope);
}

export async function requirePartnerClientAccess(
  userId: string,
  partnerId: string,
  clientId: string,
  allowedRoles: readonly (PartnerRole | ClientRole)[] = [
    ...PARTNER_ROLES,
    ...CLIENT_ROLES,
  ],
): Promise<AccessContext> {
  const roles = requireNonEmptyRoles(allowedRoles);
  const clientScope = await fetchClientScope(clientId);

  if (clientScope.partner_id !== partnerId) {
    denied("Client business not found or inaccessible.");
  }

  const partnerRoles = roles.filter((role): role is PartnerRole =>
    PARTNER_ROLES.includes(role as PartnerRole),
  );
  const clientRoles = roles.filter((role): role is ClientRole =>
    CLIENT_ROLES.includes(role as ClientRole),
  );

  const supabase = await getSupabaseOrThrow();

  if (partnerRoles.length > 0) {
    const { data, error } = await supabase
      .from("memberships")
      .select("id, user_id, partner_id, client_id, role, status")
      .eq("user_id", userId)
      .eq("partner_id", partnerId)
      .is("client_id", null)
      .eq("status", "active")
      .in("role", partnerRoles)
      .maybeSingle();

    if (error) {
      lookupFailed(error.message);
    }

    if (data) {
      return toAccessContext(data as MembershipRecord, clientScope);
    }
  }

  if (clientRoles.length > 0 && clientScope.client_portal_enabled) {
    const { data, error } = await supabase
      .from("memberships")
      .select("id, user_id, partner_id, client_id, role, status")
      .eq("user_id", userId)
      .eq("partner_id", partnerId)
      .eq("client_id", clientId)
      .eq("status", "active")
      .in("role", clientRoles)
      .maybeSingle();

    if (error) {
      lookupFailed(error.message);
    }

    if (data) {
      return toAccessContext(data as MembershipRecord, clientScope);
    }
  }

  denied("Partner or client access required.");
}
