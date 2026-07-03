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
      <div className="space-y-5">
        <header className="space-y-4 border-b pb-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <Link
                href="/partner/clients"
                className="text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Clients
              </Link>
              <h1 className="mt-1 text-2xl font-semibold">{client.name}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {client.industry ?? "Industry not set"} · {client.timezone}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{formatEnum(client.status)}</Badge>
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
          <WorkspaceTabs clientId={client.id} />
        </header>

        {children}
      </div>
    </AppShell>
  );
}
