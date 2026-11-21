"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAppUrl } from "@/lib/env";
import { firstOwnerSameOrigin } from "@/lib/auth/first-owner-rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export async function signOut(): Promise<void> {
  if (!firstOwnerSameOrigin((await headers()).get("origin"), getAppUrl())) throw new Error("Open this site directly before signing out.");
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error("Sign out is unavailable. Try again shortly.");
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw new Error("Sign out could not be completed. Try again.");
  redirect("/preview");
}
