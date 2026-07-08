import {
  isAccessError,
  requireClientAccess,
  requireClientWorkspaceAccess,
} from "@/lib/permissions/access";
import {
  CLIENT_ROLES,
  PARTNER_OPERATOR_ROLES,
  PARTNER_ROLES,
} from "@/lib/permissions/roles";
import type { AccessContext } from "@/lib/permissions/types";

// Assistant surfaces are used by two audiences with the same guarantees:
// partner operators (from the client workspace) and the client business's
// own owner/manager/staff (from the portal, which must be enabled). Reads
// allow every member role; writes require an operational role on either
// side. Viewer roles never write.

const CLIENT_WRITE_ROLES = [
  "client_owner",
  "client_manager",
  "client_staff",
] as const;

export async function resolveAssistantAccess(
  userId: string,
  clientId: string,
  mode: "read" | "write",
): Promise<AccessContext> {
  try {
    return await requireClientWorkspaceAccess(
      userId,
      clientId,
      mode === "write" ? PARTNER_OPERATOR_ROLES : PARTNER_ROLES,
    );
  } catch (error) {
    if (!isAccessError(error) || error.code !== "ACCESS_DENIED") {
      throw error;
    }
  }

  return requireClientAccess(
    userId,
    clientId,
    mode === "write" ? CLIENT_WRITE_ROLES : CLIENT_ROLES,
  );
}
