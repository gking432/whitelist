import Link from "next/link";
import { LifeBuoy } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePlatformRole } from "@/lib/permissions/access";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  supportReference,
  supportStatusLabel,
} from "@/lib/support/presentation";

export const metadata = { title: "Support Queue" };
export const dynamic = "force-dynamic";

export default async function PlatformSupportPage() {
  const user = await requireAuthenticatedUser("/control/support");
  await requirePlatformRole(user.id);
  const admin = createSupabaseAdminClient();
  if (!admin) return null;
  const { data: tickets } = await admin
    .from("support_tickets")
    .select(
      "id, title, origin, status, priority, current_route, updated_at, partner:partners(name), client:client_businesses!support_tickets_client_id_fkey(name)",
    )
    .order("updated_at", { ascending: false });
  return (
    <div className="min-w-0">
      <div className="space-y-5">
        <header>
          <div className="flex items-center gap-2">
            <LifeBuoy className="size-5 text-primary" aria-hidden="true" />
            <h1 className="text-xl font-semibold">Platform support</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Every request is visible here. Escalated, critical, and owner-routed
            work appears first.
          </p>
        </header>
        <section className="overflow-hidden rounded-lg border bg-card">
          {(tickets ?? []).length === 0 ? (
            <p className="p-8 text-sm text-muted-foreground">
              No support requests yet.
            </p>
          ) : (
            <div className="divide-y">
              {(tickets ?? [])
                .sort(
                  (a, b) =>
                    Number(
                      ["owner", "platform", "codex"].includes(b.current_route),
                    ) -
                    Number(
                      ["owner", "platform", "codex"].includes(a.current_route),
                    ),
                )
                .map((ticket) => {
                  const partner = ticket.partner as unknown as {
                    name?: string;
                  } | null;
                  const client = ticket.client as unknown as {
                    name?: string;
                  } | null;
                  return (
                    <Link
                      key={ticket.id}
                      href={`/control/support/${ticket.id}`}
                      className="grid gap-2 px-5 py-4 transition-colors hover:bg-secondary/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">
                            {ticket.title}
                          </p>
                          <Badge variant="outline">{ticket.priority}</Badge>
                          <Badge variant="outline">
                            {ticket.current_route.replaceAll("_", " ")}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {supportReference(ticket.id)} ·{" "}
                          {partner?.name ?? "Partner"} ·{" "}
                          {client?.name ?? "Agency-wide"}
                        </p>
                      </div>
                      <Badge variant="outline">
                        {supportStatusLabel(ticket.status)}
                      </Badge>
                    </Link>
                  );
                })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
