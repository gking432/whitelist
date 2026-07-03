import Link from "next/link";
import { BellCheck } from "lucide-react";

import { resolvePartnerApproval } from "@/app/partner/clients/[clientId]/approvals/actions";
import { ApprovalResolutionForm } from "@/components/approvals/approval-resolution-form";
import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Client Approvals",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

type ApprovalRow = {
  id: string;
  workflow_run_id: string | null;
  type: string;
  status: string;
  title: string;
  summary: string | null;
  risk_level: string;
  editable_content: string | null;
  resolved_content: string | null;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  proposed_payload: { channel?: string; to?: string | null } | null;
};

const riskStyles: Record<string, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-900",
  high: "border-red-200 bg-red-50 text-red-900",
};

export default async function ClientApprovalsPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { access } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("approval_items")
    .select(
      "id, workflow_run_id, type, status, title, summary, risk_level, editable_content, resolved_content, resolution_note, resolved_at, created_at, proposed_payload",
    )
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Approvals unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Approval items could not be loaded. Refresh to try again.
        </p>
      </section>
    );
  }

  const approvals = (data ?? []) as ApprovalRow[];
  const pending = approvals.filter((item) => item.status === "pending");
  const resolved = approvals.filter((item) => item.status !== "pending");
  const base = `/partner/clients/${clientId}`;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold">Approval queue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Customer-facing and high-risk actions pause here until a human
          decides. Every resolution is audited.
        </p>
      </div>

      {pending.length === 0 ? (
        <section className="flex min-h-48 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <BellCheck className="size-6 text-emerald-600" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-semibold">All clear</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            No approval items are waiting for review.
          </p>
        </section>
      ) : (
        <div className="space-y-4">
          {pending.map((item) => (
            <section key={item.id} className="rounded-lg border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="font-semibold">{item.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {item.summary}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatEnum(item.type)} · Created{" "}
                    {formatDateTime(item.created_at)}
                    {item.proposed_payload?.channel
                      ? ` · Channel: ${item.proposed_payload.channel.toUpperCase()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={riskStyles[item.risk_level] ?? ""}
                  >
                    {formatEnum(item.risk_level)} risk
                  </Badge>
                  {item.workflow_run_id ? (
                    <Link
                      href={`${base}/runs/${item.workflow_run_id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      View run
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 border-t pt-4">
                {access.canResolveApprovals ? (
                  <ApprovalResolutionForm
                    action={resolvePartnerApproval.bind(
                      null,
                      clientId,
                      item.id,
                    )}
                    editableContent={item.editable_content}
                    consequence={
                      item.type === "customer_message"
                        ? "Approving records the final message content. Live delivery to customers requires an outbound integration, which is not enabled in this release."
                        : "Approving completes the paused workflow run; rejecting cancels it."
                    }
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Your role can view this queue but not resolve items.
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
            <h3 className="text-sm font-semibold">Recently resolved</h3>
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
                  {item.resolution_note ? ` · ${item.resolution_note}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
