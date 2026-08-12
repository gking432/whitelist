import Link from "next/link";
import { Building2, Eye, FlaskConical, LifeBuoy, PlugZap, ShieldCheck, TriangleAlert, UsersRound } from "lucide-react";

import { startPlatformImpersonation } from "@/app/impersonation/actions";
import { NorthstarMark } from "@/components/brand/northstar-mark";
import { NewPartnerForm } from "@/components/control/new-partner-form";
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
};

type ClientRow = {
  id: string;
  partner_id: string;
  name: string;
  status: string;
  crm_operating_mode: string;
};

export default async function ControlRoomPage() {
  const user = await requireAuthenticatedUser("/control");
  const access = await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();

  if (!admin) return null;

  const [
    { data: partnerData },
    { data: clientData },
    { data: sessionData },
    { count: unresolvedErrorCount },
  ] =
    await Promise.all([
      admin
        .from("partners")
        .select("id, name, status")
        .order("name"),
      admin
        .from("client_businesses")
        .select(
          "id, partner_id, name, status, crm_operating_mode",
        )
        .eq("account_kind", "managed_client")
        .order("name"),
      admin
        .from("support_impersonation_sessions")
        .select("id")
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString()),
      admin
        .from("platform_error_events")
        .select("id", { count: "exact", head: true })
        .is("resolved_at", null),
    ]);

  const partners = (partnerData ?? []) as PartnerRow[];
  const clients = (clientData ?? []) as ClientRow[];
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

        <div className="flex flex-wrap justify-end gap-2">
          <Button asChild variant="outline" size="sm" className="mr-2">
            <Link href="/control/support">
              <LifeBuoy aria-hidden="true" />
              Support queue
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/control/integrations">
              <PlugZap aria-hidden="true" />
              Integration requests
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/control/provider-pilots">
              <FlaskConical aria-hidden="true" />
              Provider pilots
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/control/errors">
              <TriangleAlert aria-hidden="true" />
              Platform errors
            </Link>
          </Button>
        </div>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          <Link href="/control/errors" className="rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/40">
            <TriangleAlert className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">{unresolvedErrorCount ?? 0}</p>
            <p className="text-xs text-muted-foreground">Unresolved platform errors</p>
          </Link>
        </section>

        {["platform_owner", "platform_admin"].includes(access.role) ? (
          <section className="rounded-lg border bg-card">
            <div className="border-b px-5 py-4">
              <h2 className="font-semibold">Add a white-label partner</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Create the account and send its owner into the required brand, team, phone, and plan setup.
              </p>
            </div>
            <div className="p-5">
              <NewPartnerForm />
            </div>
          </section>
        ) : null}

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
