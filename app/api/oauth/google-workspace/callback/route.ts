import type { NextRequest } from "next/server";

import { completeWorkspaceOAuth } from "@/lib/integrations/workspace-oauth-callback";
import { verifyWorkspaceOAuthState } from "@/lib/integrations/providers/workspace-oauth";
import { completeGooglePermissionUpgrade } from "@/lib/connections/oauth";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const state = verifyWorkspaceOAuthState(request.nextUrl.searchParams.get("state") ?? "");
  if (state?.permissionAttemptId) return completeGooglePermissionUpgrade(request, state);
  return completeWorkspaceOAuth(request, "google_workspace");
}
