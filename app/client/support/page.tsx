import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";

import { createClientSupportTicket } from "@/app/client/support/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supportReference, supportStatusLabel } from "@/lib/support/presentation";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

export default async function ClientSupportPage() {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !portal.access.clientId) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const { data: tickets } = await supabase
    .from("support_tickets")
    .select("id, title, status, priority, updated_at")
    .eq("client_id", portal.access.clientId)
    .order("updated_at", { ascending: false });

  return <div className="space-y-6"><header><div className="flex items-center gap-2"><LifeBuoy className="size-5 text-primary" aria-hidden="true" /><h1 className="text-xl font-semibold">Support</h1></div><p className="mt-2 text-sm text-muted-foreground">Send a request directly to {portal.branding.partnerName}. They can review account activity and escalate it when needed.</p></header><section className="rounded-lg border bg-card p-5"><div className="mb-4 flex items-center gap-2"><Plus className="size-4 text-primary" aria-hidden="true" /><h2 className="font-semibold">New request</h2></div><form action={createClientSupportTicket} className="grid gap-4"><div className="grid gap-1.5"><Label htmlFor="support-title">What do you need help with?</Label><Input id="support-title" name="title" required maxLength={160} /></div><div className="grid gap-1.5"><Label htmlFor="support-area">Area or application</Label><Input id="support-area" name="affected_area" placeholder="Phone, CRM, calendar, automation..." maxLength={120} /></div><div className="grid gap-1.5"><Label htmlFor="support-description">What happened?</Label><Textarea id="support-description" name="description" required rows={5} maxLength={4000} placeholder="Include what you expected, what happened, and when it occurred." /></div><Button type="submit" className="w-fit">Submit request</Button></form></section><section className="overflow-hidden rounded-lg border bg-card"><div className="border-b px-5 py-4"><h2 className="font-semibold">Your requests</h2></div>{(tickets ?? []).length === 0 ? <p className="px-5 py-8 text-sm text-muted-foreground">No support requests yet.</p> : <div className="divide-y">{(tickets ?? []).map((ticket) => <Link key={ticket.id} href={`/client/support/${ticket.id}`} className="flex items-center justify-between gap-3 px-5 py-4 transition-colors hover:bg-secondary/50"><div className="min-w-0"><p className="truncate text-sm font-semibold">{ticket.title}</p><p className="mt-1 text-xs text-muted-foreground">{supportReference(ticket.id)} · Updated {new Date(ticket.updated_at).toLocaleDateString()}</p></div><Badge variant="outline">{supportStatusLabel(ticket.status)}</Badge></Link>)}</div>}</section></div>;
}

