import { AssistantConsole } from "@/components/assistant/assistant-console";
import { buildAssistantContext } from "@/lib/assistant/context";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Assistant",
};

export const dynamic = "force-dynamic";

// Client-staff Assistant Console. Same contract and the same approval
// gates as the partner workspace console; the client scope comes from the
// signed-in user's own membership, never from the URL.
export default async function ClientAssistantPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const context = await buildAssistantContext(supabase, portal.client, {
    audience: "client",
  });

  return (
    <div className="space-y-3">
      <AssistantConsole context={context} />
      <p className="text-xs leading-5 text-muted-foreground">
        Customer-facing sends and bookings always go through the approval
        queue — nothing leaves without a human approving it.
      </p>
    </div>
  );
}
