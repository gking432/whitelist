import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { WorkspaceTabs } from "@/components/partner/workspace-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return (
    <AppShell
      organizationName="Partner workspace"
      userEmail={user.email ?? "Authenticated user"}
      activeNav="clients"
    >
      <div className="space-y-6">
        <header className="overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(23,33,27,0.05),0_4px_16px_-8px_rgba(23,33,27,0.08)]">
          <div className="flex flex-col gap-4 px-5 pb-0 pt-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-base font-semibold text-primary-foreground">
                {client.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0">
                <Link
                  href="/partner/clients"
                  className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground"
                >
                  Clients
                </Link>
                <h1 className="mt-0.5 truncate text-xl font-semibold tracking-tight">
                  {client.name}
                </h1>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {client.industry ?? "Industry not set"} · {client.timezone}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{formatEnum(client.status)}</Badge>
              <Badge variant="outline">
                CRM: {formatEnum(client.crm_operating_mode)}
              </Badge>
              <Badge variant="outline">
                Runtime: {formatEnum(client.default_runtime_mode)}
              </Badge>
              <Badge variant="outline">
                Portal: {client.client_portal_enabled ? "Enabled" : "Off"}
              </Badge>
              <Badge variant="outline">
                Partner edits:{" "}
                {client.partner_can_edit_client_data ? "Granted" : "Not granted"}
              </Badge>
            </div>
          </div>
          <div className="mt-4 border-t px-5">
            <WorkspaceTabs clientId={client.id} />
          </div>
        </header>

        {children}
      </div>
    </AppShell>
  );
}
