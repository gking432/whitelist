import { LeadSourceWizard } from "@/components/partner/lead-source-wizard";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import {
  emptyIntakeAnswers,
  type IntakeAnswers,
} from "@/lib/lead-sources/catalog";

export const metadata = {
  title: "Client Setup",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function ClientSetupPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { client, access } = workspace;

  const profile =
    (client.lead_source_profile as {
      answers?: IntakeAnswers;
      saved_at?: string;
    } | null) ?? {};
  const savedAnswers = profile.answers;

  return (
    <LeadSourceWizard
      clientId={client.id}
      clientName={client.name}
      initialAnswers={savedAnswers ?? emptyIntakeAnswers}
      hasSavedPlan={Boolean(savedAnswers)}
      canManage={access.canManageIntegrations}
    />
  );
}
