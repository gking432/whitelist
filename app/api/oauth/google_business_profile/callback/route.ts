import type { NextRequest } from "next/server";
import { completeMarketingOAuth } from "@/lib/integrations/marketing-oauth-callback";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return completeMarketingOAuth(request, "google_business_profile"); }
