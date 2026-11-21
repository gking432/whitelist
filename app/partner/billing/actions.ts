"use server";
import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { billingStripe } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";

export async function openBillingPortal(): Promise<void> {
  const user = await requireAuthenticatedUser("/partner/billing");
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/partner/billing?notice=unavailable");
  const { data, error } = await admin
    .from("partner_enrollments")
    .select("stripe_customer_id")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error || !data?.stripe_customer_id)
    redirect("/partner/billing?notice=managed");
  let url: string;
  try {
    url = (
      await billingStripe().billingPortal.sessions.create({
        customer: data.stripe_customer_id,
        return_url: `${getAppUrl()}/partner/billing`,
      })
    ).url;
  } catch {
    redirect("/partner/billing?notice=unavailable");
  }
  if (new URL(url).hostname !== "billing.stripe.com")
    redirect("/partner/billing?notice=unavailable");
  redirect(url);
}
