import { BookOpenCheck } from "lucide-react";

import { KnowledgeForm } from "@/components/partner/knowledge-form";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { getKnowledgeProfile } from "@/lib/knowledge/profile";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "AI Knowledge",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

export default async function KnowledgePage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const profile = await getKnowledgeProfile(supabase, clientId);

  return (
    <div className="space-y-5">
      <section className="ns-surface rounded-lg border bg-card p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <BookOpenCheck className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="font-semibold">Approved AI knowledge</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              Everything the AI assistants (website chat, drafting, and voice
              when it ships) are allowed to say about {workspace.client.name}.
              Assistants use only this content — they never invent services,
              pricing, guarantees, or availability. Every change is audited.
            </p>
          </div>
        </div>
      </section>

      <section className="ns-surface rounded-lg border bg-card p-6">
        <KnowledgeForm
          clientId={clientId}
          profile={profile}
          canManage={workspace.access.canManageIntegrations}
        />
      </section>
    </div>
  );
}
