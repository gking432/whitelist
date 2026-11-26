"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { billingStripe, partnerCheckoutEnabled } from "@/lib/billing/stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/env";
import { PARTNER_V1_PLAN } from "@/lib/onboarding/partner";

export async function startPartnerCheckout(formData: FormData): Promise<void> {
  const { user } = await getAuthState();
  if (!user?.email_confirmed_at || !user.email) redirect("/login?next=/join");
  if (!partnerCheckoutEnabled()) redirect("/join?notice=unavailable");
  const agencyName = String(formData.get("agency_name") ?? "").trim();
  if (
    agencyName.length < 2 ||
    agencyName.length > 100 ||
    formData.get("terms") !== "on"
  )
    redirect("/join?notice=details");
  const admin = createSupabaseAdminClient();
  if (!admin) redirect("/join?notice=unavailable");
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .is("client_id", null)
    .in("role", ["partner_owner", "partner_admin"])
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (membershipError) redirect("/join?notice=unavailable");
  if (membership) redirect("/partner/onboarding");
  const { error: insertError } = await admin
    .from("partner_enrollments")
    .upsert(
      { owner_id: user.id, agency_name: agencyName },
      { onConflict: "owner_id", ignoreDuplicates: true },
    );
  if (insertError) redirect("/join?notice=unavailable");
  const { data: enrollment, error } = await admin
    .from("partner_enrollments")
    .select("*")
    .eq("owner_id", user.id)
    .single();
  if (error || !enrollment) redirect("/join?notice=unavailable");
  if (enrollment.partner_id) redirect("/partner/onboarding");
  const stripe = billingStripe();
  let url: string | null = null;
  try {
    if (enrollment.checkout_session_id) {
      const existing = await stripe.checkout.sessions.retrieve(
        enrollment.checkout_session_id,
      );
      if (existing.status === "complete") redirect("/join?notice=processing");
      if (existing.status === "open") url = existing.url;
      else {
        const nextKey = randomUUID();
        const { data: renewed, error: renewError } = await admin
          .from("partner_enrollments")
          .update({ checkout_key: nextKey, checkout_session_id: null })
          .eq("owner_id", user.id)
          .eq("checkout_session_id", existing.id)
          .eq("checkout_key", enrollment.checkout_key)
          .select("checkout_key")
          .maybeSingle();
        if (renewError || !renewed) redirect("/join?notice=processing");
        enrollment.checkout_key = renewed.checkout_key;
      }
    }
    if (!url) {
      const [monthly, setup] = await Promise.all([
        stripe.prices.retrieve(process.env.STRIPE_PARTNER_MONTHLY_PRICE_ID!),
        stripe.prices.retrieve(process.env.STRIPE_PARTNER_SETUP_PRICE_ID!),
      ]);
      if (
        !monthly.active ||
        !setup.active ||
        monthly.currency !== "usd" ||
        setup.currency !== "usd" ||
        monthly.unit_amount !== PARTNER_V1_PLAN.monthlyFeeCents ||
        setup.unit_amount !== PARTNER_V1_PLAN.setupFeeCents ||
        monthly.recurring?.interval !== "month" ||
        monthly.recurring.interval_count !== 1 ||
        setup.recurring
      )
        throw new Error("Plan mismatch");
      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          payment_method_types: ["card"],
          customer_email: user.email,
          client_reference_id: user.id,
          line_items: [
            { price: monthly.id, quantity: 1 },
            { price: setup.id, quantity: 1 },
          ],
          metadata: {
            owner_id: user.id,
            checkout_key: enrollment.checkout_key,
          },
          subscription_data: { metadata: { owner_id: user.id } },
          success_url: `${getAppUrl()}/join?notice=processing`,
          cancel_url: `${getAppUrl()}/join?notice=cancelled`,
        },
        { idempotencyKey: `partner-enrollment:${enrollment.checkout_key}` },
      );
      const { error: saveError } = await admin
        .from("partner_enrollments")
        .update({ checkout_session_id: session.id })
        .eq("owner_id", user.id)
        .eq("checkout_key", enrollment.checkout_key);
      if (saveError) throw new Error("Checkout persistence failed");
      url = session.url;
    }
  } catch (error) {
    // Preserve Next's redirect control flow; never expose provider errors/secrets.
    const { unstable_rethrow } = await import("next/navigation");
    unstable_rethrow(error);
    redirect("/join?notice=unavailable");
  }
  if (!url || new URL(url).hostname !== "checkout.stripe.com")
    redirect("/join?notice=unavailable");
  redirect(url);
}
