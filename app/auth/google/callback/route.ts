import type { NextRequest } from "next/server";
import { handleGoogleOnboardingCallback } from "@/lib/auth/google-onboarding";

export async function GET(request: NextRequest) {
  return handleGoogleOnboardingCallback(request);
}
