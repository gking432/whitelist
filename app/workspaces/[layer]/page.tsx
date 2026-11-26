import { notFound, redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { isAccessError, requirePlatformRole } from "@/lib/permissions/access";

export default async function WorkspaceEntryPage({
  params,
}: {
  params: Promise<{ layer: string }>;
}) {
  const { layer } = await params;
  if (layer !== "partner" && layer !== "client") notFound();
  const user = await requireAuthenticatedUser(`/workspaces/${layer}`);
  let platformAccess = false;
  try {
    await requirePlatformRole(user.id);
    platformAccess = true;
  } catch (error) {
    if (!isAccessError(error) || error.code !== "ACCESS_DENIED") throw error;
  }
  // Choosing a layer never grants a role. Owners must select an account and
  // explicitly start an audited support session in the account directory.
  redirect(
    platformAccess ? `/control?workspace=${layer}#accounts` : `/${layer}`,
  );
}
