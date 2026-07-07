import Link from "next/link";
import { Plus, UsersRound } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import {
  CLIENT_STATUSES,
  type ClientBusinessRecord,
} from "@/lib/clients/constants";
import { getPartnerOpsCounts } from "@/lib/clients/ops";
import { formatDateTime, formatEnum } from "@/lib/format";
import {
  computeClientHealth,
  emptyOpsCounts,
  type ClientHealthStatus,
} from "@/lib/health/client-health";
import {
  isAccessError,
  requirePrimaryPartnerAccess,
} from "@/lib/permissions/access";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";
import type { AccessContext } from "@/lib/permissions/types";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Clients",
};

export const dynamic = "force-dynamic";

const healthStyles: Record<ClientHealthStatus, string> = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-800",
  onboarding: "border-sky-200 bg-sky-50 text-sky-800",
  attention: "border-amber-200 bg-amber-50 text-amber-900",
  failing: "border-red-200 bg-red-50 text-red-900",
  paused: "border-slate-200 bg-slate-50 text-slate-700",
};

type ClientsPageProps = {
  searchParams: Promise<{ status?: string }>;
};

function AccessDenied() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">Partner access required</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Client management is available to active partner members only.
        </p>
      </div>
    </main>
  );
}

export default async function ClientsPage({ searchParams }: ClientsPageProps) {
  const user = await requireAuthenticatedUser("/partner/clients");
  const params = await searchParams;

  let access: AccessContext;

  try {
    access = await requirePrimaryPartnerAccess(user.id);
  } catch (error) {
    if (isAccessError(error)) {
      return <AccessDenied />;
    }

    throw error;
  }

  const partnerId = access.partnerId;

  if (!partnerId) {
    return <AccessDenied />;
  }

  const canManageClients = PARTNER_MANAGER_ROLES.includes(
    access.role as (typeof PARTNER_MANAGER_ROLES)[number],
  );

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <AccessDenied />;
  }

  const statusFilter = CLIENT_STATUSES.includes(params.status as never)
    ? (params.status as (typeof CLIENT_STATUSES)[number])
    : null;

  let clientsQuery = supabase
    .from("client_businesses")
    .select("*")
    .eq("partner_id", partnerId)
    .order("name", { ascending: true });

  clientsQuery = statusFilter
    ? clientsQuery.eq("status", statusFilter)
    : clientsQuery.neq("status", "archived");

  const [clientsResult, opsCounts] = await Promise.all([
    clientsQuery,
    getPartnerOpsCounts(supabase, partnerId).catch(() => null),
  ]);

  if (clientsResult.error) {
    return (
      <AppShell
        organizationName="Partner workspace"
        userEmail={user.email ?? "Authenticated user"}
        activeNav="clients"
      >
        <section className="rounded-lg border bg-card p-6">
          <h1 className="text-lg font-semibold">Clients unavailable</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Client businesses could not be loaded. Refresh to try again.
          </p>
        </section>
      </AppShell>
    );
  }

  const clients = (clientsResult.data ?? []) as ClientBusinessRecord[];

  const filters = [
    { label: "All active", value: null },
    ...CLIENT_STATUSES.map((status) => ({
      label: formatEnum(status),
      value: status as string,
    })),
  ];

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? "Authenticated user"}
      activeNav="clients"
    >
      <div className="space-y-6">
        <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Client businesses</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Manage the businesses operating under this partner organization.
            </p>
          </div>
          {canManageClients ? (
            <Button asChild>
              <Link href="/partner/clients/new">
                <Plus aria-hidden="true" />
                Add client
              </Link>
            </Button>
          ) : null}
        </header>

        <nav aria-label="Status filter" className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const isActive = filter.value === (statusFilter ?? null);
            const href = filter.value
              ? `/partner/clients?status=${filter.value}`
              : "/partner/clients";

            return (
              <Link
                key={filter.label}
                href={href}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:bg-secondary",
                )}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        {clients.length === 0 ? (
          <section className="flex min-h-72 flex-col items-center justify-center rounded-lg border bg-card px-6 py-12 text-center">
            <div className="flex size-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UsersRound className="size-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 font-semibold">
              {statusFilter
                ? `No ${formatEnum(statusFilter).toLowerCase()} clients`
                : "No client businesses yet"}
            </h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {statusFilter
                ? "No clients match this status filter."
                : "Add the first client business to begin managing integrations and automations."}
            </p>
            {canManageClients && !statusFilter ? (
              <Button asChild className="mt-5">
                <Link href="/partner/clients/new">
                  <Plus aria-hidden="true" />
                  Add client
                </Link>
              </Button>
            ) : null}
          </section>
        ) : (
          <section className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[64rem] text-left text-sm">
                <thead className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Health</th>
                    <th className="px-4 py-3 font-medium">CRM mode</th>
                    <th className="px-4 py-3 font-medium">Workflows</th>
                    <th className="px-4 py-3 font-medium">Approvals</th>
                    <th className="px-4 py-3 font-medium">Failed (7d)</th>
                    <th className="px-4 py-3 font-medium">Last event</th>
                    <th className="px-4 py-3 font-medium">Portal</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {clients.map((client) => {
                    const counts =
                      opsCounts?.get(client.id) ?? { ...emptyOpsCounts };
                    const health = computeClientHealth(client.status, counts);

                    return (
                      <tr key={client.id} className="hover:bg-secondary/30">
                        <td className="px-5 py-3.5">
                          <Link
                            href={`/partner/clients/${client.id}`}
                            className="font-medium text-foreground hover:underline"
                          >
                            {client.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {client.industry ?? "Industry not set"}
                          </p>
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge variant="outline">
                            {formatEnum(client.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5">
                          <Badge
                            variant="outline"
                            className={healthStyles[health.status]}
                          >
                            {formatEnum(health.status)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatEnum(client.crm_operating_mode)}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          {counts.activeWorkflows}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          {counts.pendingApprovals}
                        </td>
                        <td className="px-4 py-3.5 tabular-nums">
                          {counts.failedRuns7d}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {formatDateTime(counts.lastEventAt)}
                        </td>
                        <td className="px-4 py-3.5 text-muted-foreground">
                          {client.client_portal_enabled ? "Enabled" : "Off"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
