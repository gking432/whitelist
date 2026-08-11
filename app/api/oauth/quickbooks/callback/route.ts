import type { NextRequest } from "next/server";
import { completeCommerceOAuth } from "@/lib/integrations/commerce-oauth-callback";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return completeCommerceOAuth(request, "quickbooks_online"); }
