import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { openBillingPortal } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agency billing" };
export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const user = await requireAuthenticatedUser("/partner/billing");
  await requirePrimaryPartnerAccess(user.id, ["partner_owner"]);
  const db = await createSupabaseServerClient();
  const { data } = db
    ? await db
        .from("partner_enrollments")
        .select("status")
        .eq("owner_id", user.id)
        .maybeSingle()
    : { data: null };
  const { notice } = await searchParams;
  return (
    <AppShell
      organizationName="Agency billing"
      userEmail={user.email ?? ""}
      activeNav="settings"
    >
      <section className="max-w-2xl space-y-5 rounded-xl border bg-card p-8">
        <h1 className="text-2xl font-semibold">Your agency subscription</h1>
        <p className="text-sm leading-7 text-muted-foreground">
          Manage your payment method, invoices and subscription in the secure
          billing portal. Your phone, email and AI provider charges are
          separate.
        </p>
        {notice ? (
          <p role="status" className="text-sm">
            Billing could not be opened. Contact platform support if this
            continues.
          </p>
        ) : null}
        {data ? (
          <>
            <p>
              Status: <strong>{data.status.replaceAll("_", " ")}</strong>
            </p>
            <form action={openBillingPortal}>
              <Button type="submit">Manage billing</Button>
            </form>
          </>
        ) : (
          <p className="text-sm">
            Your beta billing arrangement is managed directly by the platform.
            Contact support for changes.
          </p>
        )}
      </section>
    </AppShell>
  );
}
