import { NextResponse } from "next/server";

import { toSafeNextPath } from "@/lib/auth/redirects";
import {
  getLocalDevLoginEmail,
  getLocalDevLoginPassword,
  isLocalDevAutoLoginEnabled,
} from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const nextPath = toSafeNextPath(requestUrl.searchParams.get("next"));

  if (!isLocalDevAutoLoginEnabled()) {
    return NextResponse.redirect(new URL(`/login?next=${nextPath}`, requestUrl.origin));
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.redirect(new URL(`/login?next=${nextPath}`, requestUrl.origin));
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: getLocalDevLoginEmail(nextPath),
    password: getLocalDevLoginPassword(),
  });

  if (error) {
    return NextResponse.redirect(
      new URL(`/login?next=${nextPath}&error=dev-login-failed`, requestUrl.origin),
    );
  }

  return NextResponse.redirect(new URL(nextPath, requestUrl.origin));
}
