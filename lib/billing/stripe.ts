import Stripe from "stripe";

export function partnerCheckoutEnabled(): boolean {
  return (
    process.env.PARTNER_CHECKOUT_ENABLED === "true" &&
    Boolean(
      process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      process.env.STRIPE_PARTNER_MONTHLY_PRICE_ID &&
      process.env.STRIPE_PARTNER_SETUP_PRICE_ID,
    )
  );
}

export function billingStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY)
    throw new Error("Partner billing is not configured.");
  return new Stripe(process.env.STRIPE_SECRET_KEY, {
    timeout: 15_000,
    maxNetworkRetries: 2,
  });
}
