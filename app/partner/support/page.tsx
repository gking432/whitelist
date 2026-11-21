import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";

import { createPartnerSupportTicket } from "@/app/partner/support/actions";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireAuthenticatedUser } from "@/lib/auth/session";
import { requirePrimaryPartnerAccess } from "@/lib/permissions/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supportReference, supportStatusLabel } from "@/lib/support/presentation";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function PartnerSupportPage() {
  const user = await requireAuthenticatedUser("/partner/support");
  const access = await requirePrimaryPartnerAccess(user.id);
  const supabase = await createSupabaseServerClient();
  if (!supabase || !access.partnerId) return null;
  const [{ data: partner }, { data: clients }, { data: tickets }] = await Promise.all([
    supabase.from("partners").select("name").eq("id", access.partnerId).maybeSingle(),
    supabase.from("client_businesses").select("id, name").eq("partner_id", access.partnerId).eq("account_kind", "managed_client").neq("status", "archived").order("name"),
    supabase.from("support_tickets").select("id, title, origin, status, priority, current_route, updated_at, client:client_businesses!support_tickets_client_id_fkey(name)").eq("partner_id", access.partnerId).order("updated_at", { ascending: false }),
  ]);
  return <AppShell organizationName={partner?.name ?? "Partner workspace"} userEmail={user.email ?? ""} activeNav="support"><div className="space-y-6"><header><div className="flex items-center gap-2"><LifeBuoy className="size-5 text-primary" aria-hidden="true" /><h1 className="text-xl font-semibold">Support</h1></div><p className="mt-2 text-sm text-muted-foreground">Client requests arrive here first with account-health context. Resolve them here or escalate only what needs platform help.</p></header><section className="rounded-lg border bg-card p-5"><div className="mb-4 flex items-center gap-2"><Plus className="size-4 text-primary" aria-hidden="true" /><h2 className="font-semibold">Ask platform support</h2></div><form action={createPartnerSupportTicket} className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">Client<select name="client_id" className="h-9 rounded-md border bg-background px-3 text-sm"><option value="">Agency-wide</option>{(clients ?? []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label><div className="grid gap-1.5"><Label htmlFor="partner-support-area">Area or application</Label><Input id="partner-support-area" name="affected_area" /></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="partner-support-title">Request</Label><Input id="partner-support-title" name="title" required maxLength={160} /></div><div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="partner-support-description">Details</Label><Textarea id="partner-support-description" name="description" required rows={4} maxLength={4000} /></div><Button type="submit" className="w-fit">Submit request</Button></form></section><section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-5 py-4"><h2 className="font-semibold">Support queue</h2></div>{(tickets ?? []).length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No support requests yet.</p> : <div className="divide-y">{(tickets ?? []).map((ticket) => { const client = ticket.client as unknown as { name?: string } | null; return <Link key={ticket.id} href={`/partner/support/${ticket.id}`} className="grid gap-2 px-5 py-4 transition-colors hover:bg-secondary/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold">{ticket.title}</p>{ticket.priority !== "normal" ? <Badge variant="outline">{ticket.priority}</Badge> : null}</div><p className="mt-1 text-xs text-muted-foreground">{supportReference(ticket.id)} · {client?.name ?? "Agency-wide"} · {ticket.origin === "client" ? "Client request" : "Partner request"}</p></div><Badge variant="outline">{supportStatusLabel(ticket.status)}</Badge></Link>; })}</div>}</section></div></AppShell>;
}
