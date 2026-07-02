"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/env";
import { toSafeNextPath } from "@/lib/auth/redirects";
import type { LoginActionState } from "@/app/login/state";

export async function requestLoginLink(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const emailValue = formData.get("email");
  const email =
    typeof emailValue === "string" ? emailValue.trim().toLowerCase() : "";
  const nextPath = toSafeNextPath(formData.get("next"));

  if (!email || !email.includes("@")) {
    return {
      status: "error",
      message: "Enter a valid email address.",
    };
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      status: "error",
      message: "Supabase is not configured for this environment yet.",
    };
  }

  const callbackUrl = new URL("/auth/callback", getAppUrl());
  callbackUrl.searchParams.set("next", nextPath);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  return {
    status: "success",
    message: "Check your email for a secure sign-in link.",
  };
}
