import { updateClientBusiness } from "@/app/partner/clients/actions";
import { ClientBusinessForm } from "@/components/partner/client-business-form";
import { ArchiveClientButton } from "@/components/partner/archive-client-button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { PARTNER_MANAGER_ROLES } from "@/lib/permissions/roles";

export const metadata = {
  title: "Client Settings",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function ClientSettingsPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { client, access } = workspace;
  const canManage = PARTNER_MANAGER_ROLES.includes(
    access.role as (typeof PARTNER_MANAGER_ROLES)[number],
  );

  if (!canManage) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Partner owner access required</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Client settings can be changed by partner owners and admins. Your
          role ({access.role.replaceAll("_", " ")}) has read-only access here.
        </p>
      </section>
    );
  }

  const boundUpdate = updateClientBusiness.bind(null, client.id);

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Client settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changes to portal access and partner edit permission are audited.
        </p>
        <div className="mt-6">
          <ClientBusinessForm
            action={boundUpdate}
            client={client}
            submitLabel="Save settings"
          />
        </div>
      </div>

      {client.status !== "archived" ? (
        <div className="rounded-lg border border-destructive/30 bg-card p-6">
          <h2 className="font-semibold">Archive client</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Archiving removes this client from active operations views. Data,
            logs, and audit history are retained.
          </p>
          <ArchiveClientButton clientId={client.id} clientName={client.name} />
        </div>
      ) : null}
    </div>
  );
}
