import type { NextRequest } from "next/server";
import { completeHubSpotOAuth } from "@/lib/connections/hubspot-oauth";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){return completeHubSpotOAuth(request);}
