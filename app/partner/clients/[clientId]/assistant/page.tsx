import { AssistantConsole } from "@/components/assistant/assistant-console";
import { buildAssistantContext } from "@/lib/assistant/context";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Staff Assistant Console",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

// Staff Assistant Console prototype (docs/15). Rendered inside the partner
// workspace today; the console itself is a self-contained window fed by the
// serializable AssistantContext contract, so it can move into a desktop
// tray app / extension / CRM overlay without redesign.
export default async function AssistantPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const context = await buildAssistantContext(supabase, workspace.client);

  return (
    <div className="space-y-4">
      <AssistantConsole context={context} />
      <p className="mx-auto max-w-lg text-center text-xs leading-5 text-muted-foreground">
        Prototype of the staff popup: this exact console later ships as a
        desktop tray app, browser extension, or CRM overlay so staff see it
        over the tools they already use. See{" "}
        <code className="rounded bg-secondary px-1 py-0.5">
          docs/15-staff-assistant-console.md
        </code>
        .
      </p>
    </div>
  );
}
