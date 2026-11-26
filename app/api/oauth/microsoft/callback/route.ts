import type { NextRequest } from "next/server";

import { completeWorkspaceOAuth } from "@/lib/integrations/workspace-oauth-callback";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return completeWorkspaceOAuth(request, "microsoft_365");
}
