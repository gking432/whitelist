import Link from "next/link";
import { ArrowLeft, Eye } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceTabs } from "@/components/partner/workspace-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startClientSupportView } from "@/app/impersonation/actions";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatEnum } from "@/lib/format";

export const dynamic = "force-dynamic";

type ClientWorkspaceLayoutProps = {
  children: React.ReactNode;
  params: Promise<{ clientId: string }>;
};

function WorkspaceMessage({
  title,
  detail,
}: {
  title: string;
  detail: string;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{detail}</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/partner/clients">
            <ArrowLeft aria-hidden="true" />
            Back to clients
          </Link>
        </Button>
      </div>
    </main>
  );
}

export default async function ClientWorkspaceLayout({
  children,
  params,
}: ClientWorkspaceLayoutProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind === "denied") {
    return (
      <WorkspaceMessage
        title="Client not found"
        detail="This client business does not exist or is not accessible from your partner organization."
      />
    );
  }

  if (workspace.kind === "unavailable") {
    return (
      <WorkspaceMessage
        title="Client workspace unavailable"
        detail="The client workspace could not be loaded. Try again shortly."
      />
    );
  }

  const { client, user } = workspace;
  const isAgencyAccount = client.account_kind === "partner_agency";
  const hasNorthstarCrm = ["primary_crm", "mirror", "assist"].includes(
    client.crm_operating_mode,
  );

  return (
    <AppShell
      organizationName={isAgencyAccount ? client.name : "Partner workspace"}
      userEmail={user.email ?? "Authenticated user"}
      activeNav={isAgencyAccount ? "agency" : "clients"}
    >
      <div className="space-y-6">
        <header className="relative rounded-lg border bg-card ns-surface">
          <div className="flex flex-col gap-4 px-5 pb-0 pt-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary">
                {client.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <Link
                  href={
                    isAgencyAccount ? "/partner/agency" : "/partner/clients"
                  }
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  {isAgencyAccount ? "Agency home base" : "Clients"}
                </Link>
                <h1 className="mt-0.5 truncate text-lg font-semibold tracking-tight">
                  {client.name}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {isAgencyAccount
                    ? "Your internal CRM, assistants, and agency automations"
                    : `${client.industry ?? "Industry not set"} · ${client.timezone}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {!isAgencyAccount && hasNorthstarCrm ? (
                <form
                  action={startClientSupportView.bind(
                    null,
                    client.id,
                    client.is_test_account ? "sandbox_full" : "read_only",
                  )}
                >
                  <Button type="submit" variant="outline" size="sm">
                    <Eye aria-hidden="true" />
                    {client.is_test_account
                      ? "Test as client"
                      : "View as client"}
                  </Button>
                </form>
              ) : null}
              <Badge variant="secondary">{formatEnum(client.status)}</Badge>
              <Badge variant="outline">
                {formatEnum(client.default_runtime_mode)}
              </Badge>
            </div>
          </div>
          <details className="mx-5 mt-4 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer py-1">
              Account details & access
            </summary>
            <dl className="grid gap-3 py-3 sm:grid-cols-3">
              <div>
                <dt>Customer system</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {isAgencyAccount
                    ? "Your agency workspace"
                    : formatEnum(client.crm_operating_mode)}
                </dd>
              </div>
              <div>
                <dt>Client portal</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {client.client_portal_enabled ? "Enabled" : "Not enabled"}
                </dd>
              </div>
              <div>
                <dt>Permission to edit client data</dt>
                <dd className="mt-1 font-medium text-foreground">
                  {client.partner_can_edit_client_data
                    ? "Granted"
                    : "Not granted"}
                </dd>
              </div>
            </dl>
          </details>
          <div className="mt-4 border-t px-5">
            <WorkspaceTabs
              clientId={client.id}
              accountKind={client.account_kind}
            />
          </div>
        </header>

        {children}
      </div>
    </AppShell>
  );
}
