import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth/session";
import { partnerCheckoutEnabled } from "@/lib/billing/stripe";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startPartnerCheckout } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatPlanPrice, PARTNER_V1_PLAN } from "@/lib/onboarding/partner";

export const dynamic = "force-dynamic";
export const metadata = { title: "Launch your AI agency" };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { user } = await getAuthState();
  const supabase = await createSupabaseServerClient();
  if (user && supabase) {
    const { data } = await supabase
      .from("partner_enrollments")
      .select("partner_id")
      .eq("owner_id", user.id)
      .maybeSingle();
    if (data?.partner_id) redirect("/partner/onboarding");
  }
  const { notice } = await searchParams;
  const messages: Record<string, string> = {
    processing:
      "Payment confirmation is being processed. Refresh this page to enter your workspace; do not pay again.",
    cancelled: "Checkout cancelled. No agency was activated.",
    details: "Enter your agency name and acknowledge the beta terms.",
    expired: "Your checkout expired. Contact platform support to restart it.",
    unavailable:
      "Enrollment is currently unavailable. Contact platform support for beta access.",
  };
  return (
    <main className="mx-auto max-w-5xl space-y-10 px-6 py-16">
      <header className="max-w-2xl space-y-4">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          Agency partner beta
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Your brand. Your clients.
          <br />
          Your AI implementation agency.
        </h1>
        <p className="text-lg leading-8 text-muted-foreground">
          Sell practical AI services to local businesses. Brand your workspace,
          choose a repeatable offer and guide each client from account
          connection to a verified launch.
        </p>
      </header>
      <ol className="grid gap-4 sm:grid-cols-3">
        {[
          [
            "1",
            "Make it yours",
            "Add your agency name, logo and support details.",
          ],
          [
            "2",
            "Choose your offer",
            "Start with lead response, appointment assistance or live call assistance.",
          ],
          [
            "3",
            "Launch together",
            "Invite the client to connect their accounts and approve customer-facing actions.",
          ],
        ].map(([number, title, detail]) => (
          <li key={number} className="rounded-xl border bg-card p-6">
            <span className="text-sm text-primary">{number}</span>
            <h2 className="mt-2 font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {detail}
            </p>
          </li>
        ))}
      </ol>
      <section className="grid gap-8 rounded-xl border bg-card p-8 md:grid-cols-2">
        <div>
          <h2 className="text-xl font-semibold">White-label partner</h2>
          <p className="mt-4 text-3xl font-semibold">
            {formatPlanPrice(PARTNER_V1_PLAN.monthlyFeeCents)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              / month
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatPlanPrice(PARTNER_V1_PLAN.setupFeeCents)} one-time setup ·{" "}
            {PARTNER_V1_PLAN.includedActiveClients} active clients included
          </p>
          <p className="mt-5 text-sm leading-6">
            Phone, email and AI provider usage is separate. Beta capabilities
            require connected accounts and a supervised launch; provider
            approval may be required.
          </p>
        </div>
        <div>
          {notice && messages[notice] ? (
            <p
              role="status"
              className="mb-4 rounded-lg bg-secondary p-4 text-sm"
            >
              {messages[notice]}
            </p>
          ) : null}
          {!partnerCheckoutEnabled() ? (
            <p className="text-sm leading-6">
              Self-service enrollment is not open yet. Existing beta partners
              can{" "}
              <Link className="underline" href="/login">
                sign in
              </Link>
              .
            </p>
          ) : !user ? (
            <Button asChild>
              <Link href="/login?next=/join">
                Verify your email to get started
              </Link>
            </Button>
          ) : (
            <form action={startPartnerCheckout} className="space-y-4">
              <label
                className="block text-sm font-medium"
                htmlFor="agency-name"
              >
                Agency name
              </label>
              <Input
                id="agency-name"
                name="agency_name"
                required
                minLength={2}
                maxLength={100}
                placeholder="Your agency"
              />
              <label className="flex items-start gap-3 text-sm leading-6">
                <input className="mt-1" type="checkbox" name="terms" required />
                I understand this is a supervised beta, the prices shown above
                and that provider usage is billed separately.
              </label>
              <Button type="submit">Continue to secure checkout</Button>
              <p className="text-xs text-muted-foreground">
                Your verified account: {user.email}
              </p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}
