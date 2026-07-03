import { ScrollText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Audit Log",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

type AuditRow = {
  id: string;
  actor_role: string | null;
  action: string;
  target_type: string;
  summary: string | null;
  created_at: string;
  actor: { email: string | null; full_name: string | null } | null;
};

export default async function ClientAuditPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("audit_events")
    .select(
      "id, actor_role, action, target_type, summary, created_at, actor:profiles!audit_events_actor_user_id_fkey(email, full_name)",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Audit log unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Audit events could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const events = (data ?? []) as unknown as AuditRow[];

  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="font-semibold">Audit log</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Sensitive actions taken against this client. Snapshots are redacted
          before storage.
        </p>
      </div>

      {events.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center px-6 py-10 text-center">
          <ScrollText
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">
            No sensitive activity yet
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Client changes, integration updates, workflow changes, and approval
            resolutions will appear here.
          </p>
        </div>
      ) : (
        <div className="divide-y">
          {events.map((event) => (
            <div key={event.id} className="px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{event.action}</Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(event.created_at)}
                </span>
              </div>
              <p className="mt-2 text-sm">{event.summary ?? event.action}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {event.actor?.full_name ?? event.actor?.email ?? "System"}
                {event.actor_role
                  ? ` · ${event.actor_role.replaceAll("_", " ")}`
                  : ""}
                {" · "}
                {event.target_type}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
