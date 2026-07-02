export type MembershipRole =
  | "platform_owner"
  | "platform_admin"
  | "platform_support"
  | "partner_owner"
  | "partner_admin"
  | "partner_implementer"
  | "partner_viewer"
  | "client_owner"
  | "client_manager"
  | "client_staff"
  | "client_viewer";

export type PlatformRole = Extract<
  MembershipRole,
  "platform_owner" | "platform_admin" | "platform_support"
>;

export type PartnerRole = Extract<
  MembershipRole,
  "partner_owner" | "partner_admin" | "partner_implementer" | "partner_viewer"
>;

export type ClientRole = Extract<
  MembershipRole,
  "client_owner" | "client_manager" | "client_staff" | "client_viewer"
>;

export type AccessContext = {
  userId: string;
  role: MembershipRole;
  membershipId?: string;
  partnerId?: string;
  clientId?: string;
  canEditClientData: boolean;
  canManageIntegrations: boolean;
  canManageWorkflows: boolean;
  canResolveApprovals: boolean;
  canViewSensitiveLogs: boolean;
};
