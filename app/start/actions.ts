"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getAppUrl } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { provisionFirstOwner } from "@/lib/auth/first-owner";
import { firstOwnerSameOrigin, FirstOwnerValidationError } from "@/lib/auth/first-owner-rules";
import type { FirstOwnerFormState } from "./state";
export async function createFirstOwnerBusiness(_previous: FirstOwnerFormState, formData: FormData): Promise<FirstOwnerFormState> {
  if (!firstOwnerSameOrigin((await headers()).get("origin"), getAppUrl())) return { status: "error", message: "Open this site directly before creating your business." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { status: "error", message: "Business setup is unavailable. Try again shortly." };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user || data.user.is_anonymous || !data.user.email_confirmed_at)
    return { status: "error", message: "Sign in with a verified email before creating your business." };
  let destination: string;
  try {
    const result = await provisionFirstOwner(supabase, { key: formData.get("key"), business: { name: formData.get("name"), description: formData.get("description"), timezone: formData.get("timezone") } });
    destination = result.destination;
  } catch (error) {
    if (error instanceof FirstOwnerValidationError) return { status: "error", message: error.message, fields: error.fields };
    return { status: "error", message: error instanceof Error ? error.message : "Business setup could not be completed. Refresh this page and try again." };
  }
  redirect(destination);
}
