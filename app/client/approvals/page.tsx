import { BellCheck } from "lucide-react";

import { resolveClientApproval } from "@/app/client/approvals/actions";
import { ApprovalResolutionForm } from "@/components/approvals/approval-resolution-form";
import { Badge } from "@/components/ui/badge";
import { loadClientPortal } from "@/lib/clients/portal";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clientHomePath } from "@/lib/permissions/client-sections";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type ApprovalRow = {
  id: string;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  risk_level: string;
  editable_content: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
};

export default async function ClientPortalApprovalsPage() {
  const portal = await loadClientPortal();

  if (portal.kind !== "ok") {
    return null;
  }
  if (!portal.access.visibleClientSections.includes("approvals")) {
    redirect(
      clientHomePath(
        portal.access.visibleClientSections,
        portal.client.client_experience_mode,
      ),
    );
  }

  const { access } = portal;
  const supabase = await createSupabaseServerClient();

  if (!supabase || !access.clientId) {
    return null;
  }

  const { data, error } = await supabase
    .from("approval_items")
    .select(
      "id, type, status, title, summary, risk_level, editable_content, resolution_note, resolved_at, created_at",
    )
    .eq("client_id", access.clientId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h1 className="font-semibold">Approvals unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Approvals could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const approvals = (data ?? []) as ApprovalRow[];
  const pending = approvals.filter((item) => item.status === "pending");
  const resolved = approvals.filter((item) => item.status !== "pending");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold">Approvals</h1>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          Actions that need a decision from your business before anything is
          sent or changed.
        </p>
      </header>

      {pending.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <BellCheck className="size-6 text-emerald-600" aria-hidden="true" />
          <h2 className="mt-3 text-sm font-semibold">All clear</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Nothing is waiting for your review.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {pending.map((item) => (
            <section key={item.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">{item.title}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.summary}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Created {formatDateTime(item.created_at)}
                  </p>
                </div>
                <Badge variant="outline">
                  {formatEnum(item.risk_level)} risk
                </Badge>
              </div>
              <div className="mt-4 border-t pt-4">
                {access.canResolveApprovals ? (
                  <ApprovalResolutionForm
                    action={resolveClientApproval.bind(null, item.id)}
                    editableContent={item.editable_content}
                    consequence="Approving records your decision and completes the automation. Rejecting cancels it. Nothing is sent to your customers without an approval."
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Your account can view approvals but not resolve them.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {resolved.length > 0 ? (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">Recently resolved</h2>
          </div>
          <div className="divide-y">
            {resolved.slice(0, 10).map((item) => (
              <div key={item.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-medium">{item.title}</p>
                  <Badge variant="outline">{formatEnum(item.status)}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Resolved {formatDateTime(item.resolved_at)}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
