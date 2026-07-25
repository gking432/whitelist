import Link from "next/link";
import { Building2, Eye, FlaskConical, ShieldCheck, UsersRound } from "lucide-react";

import { startPlatformImpersonation } from "@/app/impersonation/actions";
import { NorthstarMark } from "@/components/brand/northstar-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Northstar Control Room" };
export const dynamic = "force-dynamic";

type PartnerRow = {
  id: string;
  name: string;
  status: string;
  is_test_account: boolean;
};

type ClientRow = {
  id: string;
  partner_id: string;
  name: string;
  status: string;
  crm_operating_mode: string;
  is_test_account: boolean;
};

export default async function ControlRoomPage() {
  const user = await requireAuthenticatedUser("/control");
  const access = await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();

  if (!admin) return null;

  const [{ data: partnerData }, { data: clientData }, { data: sessionData }] =
    await Promise.all([
      admin
        .from("partners")
        .select("id, name, status, is_test_account")
        .order("name"),
      admin
        .from("client_businesses")
        .select(
          "id, partner_id, name, status, crm_operating_mode, is_test_account",
        )
        .eq("account_kind", "managed_client")
        .order("name"),
      admin
        .from("support_impersonation_sessions")
        .select("id")
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString()),
    ]);

  const partners = (partnerData ?? []) as PartnerRow[];
  const clients = (clientData ?? []) as ClientRow[];
  const testPartner = partners.find((partner) => partner.is_test_account);
  const hasTestClient = clients.some((client) => client.is_test_account);
  const clientsByPartner = new Map<string, ClientRow[]>();

  for (const client of clients) {
    const list = clientsByPartner.get(client.partner_id) ?? [];
    list.push(client);
    clientsByPartner.set(client.partner_id, list);
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <NorthstarMark surface="light" subtitle="Control Room" />
          <Badge variant="outline">{access.role.replaceAll("_", " ")}</Badge>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-xl font-semibold">Master dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Support visibility across partners and managed clients. Every account view is audited and time-limited.
          </p>
        </div>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border bg-card p-4">
            <UsersRound className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">{partners.length}</p>
            <p className="text-xs text-muted-foreground">Partner accounts</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <Building2 className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">{clients.length}</p>
            <p className="text-xs text-muted-foreground">Managed clients</p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">{sessionData?.length ?? 0}</p>
            <p className="text-xs text-muted-foreground">Active support views</p>
          </div>
        </section>

        <section className="rounded-lg border border-sky-200 bg-sky-50 p-5">
          <div className="flex items-start gap-3">
            <FlaskConical className="mt-0.5 size-5 text-sky-800" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold text-sky-950">Test identities</h2>
              <p className="mt-1 text-sm text-sky-900/80">
                These accounts permit full sandbox actions. Real account views below are read-only.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {testPartner ? (
                  <form
                    action={startPlatformImpersonation.bind(
                      null,
                      {
                        targetKind: "partner",
                        targetId: testPartner.id,
                        requestedMode: "sandbox_full",
                      },
                    )}
                  >
                    <Button type="submit" size="sm">
                      <UsersRound aria-hidden="true" />
                      Act as fake partner
                    </Button>
                  </form>
                ) : null}
                {hasTestClient ? (
                  <Button asChild size="sm" variant="outline" className="bg-white/70">
                    <Link href="/control/pilot">
                      <Building2 aria-hidden="true" />
                      Run full V1 pilot
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="font-semibold">Partner accounts</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Enter a partner workspace to see exactly what they see without changing their data.
            </p>
          </div>
          <div className="divide-y">
            {partners.map((partner) => {
              const partnerClients = clientsByPartner.get(partner.id) ?? [];

              return (
                <div key={partner.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{partner.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {partnerClients.length} client{partnerClients.length === 1 ? "" : "s"} · {partner.status}
                    </p>
                  </div>
                  <form
                    action={startPlatformImpersonation.bind(
                      null,
                      {
                        targetKind: "partner",
                        targetId: partner.id,
                        requestedMode: "read_only",
                      },
                    )}
                  >
                    <Button type="submit" variant="outline" size="sm">
                      <Eye aria-hidden="true" />
                      View as partner
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}
