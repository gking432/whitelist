import type { NextRequest } from "next/server";
import { handleGoogleOnboardingStart } from "@/lib/auth/google-onboarding";

export async function POST(request: NextRequest) {
  return handleGoogleOnboardingStart(request);
}
