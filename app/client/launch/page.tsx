import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { acceptSupervisedBeta } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review your beta launch" };

export default async function ClientLaunchPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (portal.access.role !== "client_owner" || portal.access.isImpersonating)
    return (
      <p>
        Only the business owner can approve a beta launch from their own
        account.
      </p>
    );
  const db = await createSupabaseServerClient();
  const { data } = db
    ? await db
        .from("client_beta_acceptances")
        .select("accepted_at,provider_test_notes,fallback_contact,package_id")
        .eq("client_id", portal.client.id)
        .maybeSingle()
    : { data: null };
  const { notice } = await searchParams;
  const messages: Record<string, string> = {
    saved:
      "Your approval is saved. Your partner can continue the supervised launch.",
    incomplete: "Complete the checks, test notes and fallback contact.",
    package: "Ask your partner to assign your package first.",
    unavailable: "Your approval could not be saved. Please try again.",
    owner: "Sign in as the business owner to approve.",
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Review your beta launch</h1>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Work through this with your implementation partner before connecting
          live customer interactions. This records your business’s approval; it
          is not an automated certification or a substitute for privacy and
          consent advice.
        </p>
      </header>
      {messages[notice ?? ""] ? (
        <p role="status" className="rounded-lg border bg-secondary p-4 text-sm">
          {messages[notice ?? ""]}
        </p>
      ) : null}
      {data ? (
        <p className="text-sm">
          Last recorded approval:{" "}
          {new Date(data.accepted_at).toLocaleDateString("en-US")}. A different
          package needs a new approval.
        </p>
      ) : null}
      <form
        action={acceptSupervisedBeta}
        className="space-y-5 rounded-xl border bg-card p-6"
      >
        {[
          [
            "accounts",
            "I own or have permission to connect these business accounts and understand provider usage charges.",
          ],
          [
            "consent",
            "We reviewed AI disclosure, call/transcription consent, privacy, retention and messaging permissions for our business.",
          ],
          [
            "supervision",
            "A named person will monitor the beta, approve customer actions and handle failures or customer requests.",
          ],
        ].map(([key, label]) => (
          <label key={key} className="flex items-start gap-3 text-sm leading-6">
            <input type="checkbox" name={key} required className="mt-1" />
            {label}
          </label>
        ))}
        <label className="block text-sm font-medium" htmlFor="test-notes">
          What did you and your partner test, and what still needs checking?
        </label>
        <textarea
          id="test-notes"
          name="provider_test_notes"
          minLength={40}
          maxLength={2000}
          required
          defaultValue={data?.provider_test_notes ?? ""}
          className="min-h-32 w-full rounded-md border bg-background p-3 text-sm"
          placeholder="Describe the sample lead, call, message and booking you checked; identify any steps that still require supervised provider testing."
        />
        <label className="block text-sm font-medium" htmlFor="fallback-contact">
          Who should receive issues and customer handoffs?
        </label>
        <Input
          id="fallback-contact"
          name="fallback_contact"
          required
          minLength={5}
          maxLength={320}
          defaultValue={data?.fallback_contact ?? ""}
          placeholder="Name and business phone or email"
        />
        <Button type="submit">Approve supervised beta setup</Button>
        <p className="text-xs leading-5 text-muted-foreground">
          This does not approve individual customer messages or bookings and
          does not turn any service on.
        </p>
      </form>
    </div>
  );
}
