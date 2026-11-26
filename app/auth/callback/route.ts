import { NextResponse } from "next/server";
import { toSafeNextPath } from "@/lib/auth/redirects";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const nextPath = toSafeNextPath(requestUrl.searchParams.get("next"));
  let valid = false;
  if (code) {
    const supabase = await createSupabaseServerClient();
    if (supabase) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      valid = !error && Boolean(data.user);
    }
  }
  const destination = valid ? nextPath : `/login?error=auth-link-invalid&next=${encodeURIComponent(nextPath)}`;
  const response = NextResponse.redirect(new URL(destination, requestUrl.origin));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
