import type {
  AccessContext,
  ClientRole,
  MembershipRole,
  PartnerRole,
  PlatformRole,
} from "@/lib/permissions/types";

export const PLATFORM_ROLES = [
  "platform_owner",
  "platform_admin",
  "platform_support",
] as const satisfies readonly PlatformRole[];

export const PARTNER_ROLES = [
  "partner_owner",
  "partner_admin",
  "partner_implementer",
  "partner_viewer",
] as const satisfies readonly PartnerRole[];

export const CLIENT_ROLES = [
  "client_owner",
  "client_manager",
  "client_staff",
  "client_viewer",
] as const satisfies readonly ClientRole[];

export const PARTNER_MANAGER_ROLES = [
  "partner_owner",
  "partner_admin",
] as const satisfies readonly PartnerRole[];

export const PARTNER_OPERATOR_ROLES = [
  "partner_owner",
  "partner_admin",
  "partner_implementer",
] as const satisfies readonly PartnerRole[];

export const CLIENT_APPROVER_ROLES = [
  "client_owner",
  "client_manager",
  "client_staff",
] as const satisfies readonly ClientRole[];

const PARTNER_OPERATOR_ROLE_SET = new Set<MembershipRole>(PARTNER_OPERATOR_ROLES);
const CLIENT_APPROVER_ROLE_SET = new Set<MembershipRole>(CLIENT_APPROVER_ROLES);

export function isPlatformRole(role: MembershipRole): role is PlatformRole {
  return PLATFORM_ROLES.includes(role as PlatformRole);
}

export function isPartnerRole(role: MembershipRole): role is PartnerRole {
  return PARTNER_ROLES.includes(role as PartnerRole);
}

export function isClientRole(role: MembershipRole): role is ClientRole {
  return CLIENT_ROLES.includes(role as ClientRole);
}

type CapabilityInput = {
  userId: string;
  role: MembershipRole;
  membershipId?: string;
  partnerId?: string;
  clientId?: string;
  clientPortalEnabled?: boolean;
  partnerCanEditClientData?: boolean;
};

export function buildAccessContext(input: CapabilityInput): AccessContext {
  const isPlatform = isPlatformRole(input.role);
  const isPartner = isPartnerRole(input.role);
  const isClient = isClientRole(input.role);
  const partnerCanEditClientData = Boolean(input.partnerCanEditClientData);

  return {
    userId: input.userId,
    role: input.role,
    membershipId: input.membershipId,
    partnerId: input.partnerId,
    clientId: input.clientId,
    canEditClientData:
      isPlatform ||
      (isPartner &&
        partnerCanEditClientData &&
        PARTNER_OPERATOR_ROLE_SET.has(input.role)) ||
      (isClient && ["client_owner", "client_manager"].includes(input.role)),
    canManageIntegrations:
      isPlatform ||
      (isPartner && PARTNER_OPERATOR_ROLE_SET.has(input.role)) ||
      input.role === "client_owner",
    canManageWorkflows:
      isPlatform ||
      (isPartner && PARTNER_OPERATOR_ROLE_SET.has(input.role)) ||
      input.role === "client_owner",
    canResolveApprovals:
      isPlatform ||
      (isPartner && PARTNER_OPERATOR_ROLE_SET.has(input.role)) ||
      (isClient && CLIENT_APPROVER_ROLE_SET.has(input.role)),
    canViewSensitiveLogs:
      ["platform_owner", "platform_admin", "partner_owner", "partner_admin"].includes(
        input.role,
      ),
  };
}
