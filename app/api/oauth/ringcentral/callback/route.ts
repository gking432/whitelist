import type { NextRequest } from "next/server";
import { completeTelephonyOAuth } from "@/lib/integrations/telephony-oauth-callback";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return completeTelephonyOAuth(request, "ringcentral"); }
