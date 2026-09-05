import Link from "next/link";
import {
  Building2,
  Eye,
  LifeBuoy,
  Rocket,
  TriangleAlert,
  UsersRound,
} from "lucide-react";

import { startPlatformImpersonation } from "@/app/impersonation/actions";
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

export default async function ControlRoomPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; q?: string }>;
}) {
  const { workspace, q = "" } = await searchParams;
  const query = q.trim().toLowerCase();
  const user = await requireAuthenticatedUser("/control");
  const access = await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();

  if (!admin) return null;

  const [
    { data: partnerData, error: partnerError },
    { data: clientData, error: clientError },
    escalationsResult,
    { count: unresolvedErrorCount, error: issueError },
  ] = await Promise.all([
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
      .from("support_tickets")
      .select("id, title, partner_id, client_id, priority", { count: "exact" })
      .not("status", "in", "(resolved,closed)")
      .or("status.eq.escalated,current_route.in.(owner,platform,codex)")
      .order("updated_at", { ascending: false })
      .limit(5),
    admin
      .from("platform_error_events")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
  ]);

  if (escalationsResult.error || partnerError || clientError || issueError)
    throw new Error(
      "Unable to load platform accounts and activity. Please try again.",
    );
  const partners = (partnerData ?? []) as PartnerRow[];
  const clients = (clientData ?? []) as ClientRow[];
  const clientsByPartner = new Map<string, ClientRow[]>();

  for (const client of clients) {
    const list = clientsByPartner.get(client.partner_id) ?? [];
    list.push(client);
    clientsByPartner.set(client.partner_id, list);
  }

  const matchingPartners = partners.filter((partner) =>
    [
      partner.name,
      partner.id,
      ...(clientsByPartner.get(partner.id) ?? []).flatMap((client) => [
        client.name,
        client.id,
      ]),
    ].some((value) => value.toLowerCase().includes(query)),
  );

  return (
    <div className="min-w-0">
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Your platform</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            See how your partners are doing, resolve issues, and prepare the
            platform for launch.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/control/activation">
              <Rocket aria-hidden="true" />
              Launch readiness
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/control/support">
              <LifeBuoy aria-hidden="true" />
              Support queue
            </Link>
          </Button>
        </div>

        <section
          aria-label="Platform overview"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <div className="rounded-lg border bg-card p-4">
            <UsersRound className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">
              {partners.filter((partner) => !partner.is_test_account).length}
            </p>
            <p className="text-xs text-muted-foreground">
              Live partner accounts
            </p>
          </div>
          <div className="rounded-lg border bg-card p-4">
            <Building2 className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">
              {clients.filter((client) => !client.is_test_account).length}
            </p>
            <p className="text-xs text-muted-foreground">
              Live managed clients
            </p>
          </div>
          <Link
            href="/control/support"
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/40"
          >
            <LifeBuoy className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">
              {escalationsResult.count ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">
              Escalations to review
            </p>
          </Link>
          <Link
            href="/control/errors"
            className="rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/40"
          >
            <TriangleAlert className="size-4 text-primary" aria-hidden="true" />
            <p className="mt-3 text-2xl font-semibold">
              {unresolvedErrorCount ?? 0}
            </p>
            <p className="text-xs text-muted-foreground">Issues to resolve</p>
          </Link>
        </section>

        {["platform_owner", "platform_admin"].includes(access.role) ? (
          <details className="ns-disclosure rounded-xl border bg-card">
            <summary>Add a partner</summary>
            <div className="px-5 pb-5">
              <p className="mb-5 text-sm text-muted-foreground">
                Create their account. They will follow a guided setup for their
                brand, team, phone, and plan.
              </p>
              <NewPartnerForm />
            </div>
          </details>
        ) : null}

        {escalationsResult.data?.length ? (
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Needs your attention</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Recent unresolved requests escalated to your team.
            </p>
            <div className="mt-3 divide-y">
              {escalationsResult.data.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/control/support/${ticket.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm hover:text-primary"
                >
                  <span>
                    <span className="font-medium">{ticket.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {partners.find(
                        (partner) => partner.id === ticket.partner_id,
                      )?.name ?? "Partner"}{" "}
                      ·{" "}
                      {clients.find((client) => client.id === ticket.client_id)
                        ?.name ?? "Agency-wide"}
                    </span>
                  </span>
                  <Badge variant="outline">{ticket.priority}</Badge>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        <section
          id="accounts"
          className="scroll-mt-44 overflow-hidden rounded-xl border bg-card"
        >
          <div className="border-b p-5">
            <h2 className="font-semibold">
              {workspace === "partner"
                ? "Choose a partner workspace"
                : workspace === "client"
                  ? "Choose a client workspace"
                  : "Partners & clients"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Each client belongs to a partner. Open a support view to see their
              workspace. Test accounts allow changes; live accounts open in
              read-only mode.
            </p>
            <form
              action="/control#accounts"
              className="mt-4 flex flex-wrap gap-2"
              role="search"
            >
              {workspace ? (
                <input type="hidden" name="workspace" value={workspace} />
              ) : null}
              <label className="sr-only" htmlFor="account-search">
                Find a partner or client by name or ID
              </label>
              <input
                id="account-search"
                name="q"
                defaultValue={q}
                placeholder="Find a partner or client by name or ID"
                className="h-10 min-w-0 flex-1 rounded-md border bg-background px-3 text-sm"
              />
              <Button type="submit" variant="outline">
                Search
              </Button>
              {q ? (
                <Button asChild variant="ghost">
                  <Link
                    href={
                      workspace === "partner" || workspace === "client"
                        ? `/control?workspace=${workspace}#accounts`
                        : "/control#accounts"
                    }
                  >
                    Clear
                  </Link>
                </Button>
              ) : null}
            </form>
          </div>
          <div className="divide-y">
            {matchingPartners.map((partner) => {
              const partnerClients = clientsByPartner.get(partner.id) ?? [];
              return (
                <article key={partner.id} className="p-5">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold">
                          {partner.name}
                        </h3>
                        {partner.is_test_account ? (
                          <Badge variant="outline">Test account</Badge>
                        ) : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {partnerClients.length} client
                        {partnerClients.length === 1 ? "" : "s"} ·{" "}
                        {partner.status}
                      </p>
                    </div>
                    <form
                      action={startPlatformImpersonation.bind(null, {
                        targetKind: "partner",
                        targetId: partner.id,
                        requestedMode: partner.is_test_account
                          ? "sandbox_full"
                          : "read_only",
                      })}
                    >
                      <Button type="submit" variant="outline" size="sm">
                        <Eye aria-hidden="true" />
                        {partner.is_test_account
                          ? "Test partner workspace"
                          : "View as partner"}
                      </Button>
                    </form>
                  </div>
                  <details className="mt-3 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Partner ID</summary>
                    <p className="mt-2 break-all font-mono select-all">
                      {partner.id}
                    </p>
                  </details>
                  <details
                    className="ns-disclosure mt-4 rounded-lg border"
                    open={workspace === "client" || Boolean(query)}
                  >
                    <summary>Clients ({partnerClients.length})</summary>
                    <div className="divide-y px-4 pb-2">
                      {partnerClients.length === 0 ? (
                        <p className="pb-3 text-sm text-muted-foreground">
                          No clients yet. Add the first client from this
                          partner’s workspace.
                        </p>
                      ) : (
                        partnerClients.map((client) => (
                          <div
                            key={client.id}
                            className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="text-sm font-medium">
                                  {client.name}
                                </h4>
                                <Badge variant="outline">
                                  {client.is_test_account
                                    ? "Test account"
                                    : client.status}
                                </Badge>
                              </div>
                              <details className="mt-2 text-xs text-muted-foreground">
                                <summary className="cursor-pointer">
                                  Client ID
                                </summary>
                                <p className="mt-2 break-all font-mono select-all">
                                  {client.id}
                                </p>
                              </details>
                            </div>
                            <form
                              action={startPlatformImpersonation.bind(null, {
                                targetKind: "client",
                                targetId: client.id,
                                requestedMode: client.is_test_account
                                  ? "sandbox_full"
                                  : "read_only",
                                returnPath:
                                  "/control?workspace=client#accounts",
                              })}
                            >
                              <Button type="submit" variant="outline" size="sm">
                                <Eye aria-hidden="true" />
                                {client.is_test_account
                                  ? "Test client workspace"
                                  : "View as client"}
                              </Button>
                            </form>
                          </div>
                        ))
                      )}
                    </div>
                  </details>
                </article>
              );
            })}
            {matchingPartners.length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">
                {query
                  ? "No matching accounts. Try another name or ID."
                  : "No partners yet. Add a partner above to start their guided setup."}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
