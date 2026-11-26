import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { addClientSupportMessage } from "@/app/client/support/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { loadClientPortal } from "@/lib/clients/portal";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supportReference, supportStatusLabel } from "@/lib/support/presentation";

export const dynamic = "force-dynamic";

export default async function ClientSupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;
  const portal = await loadClientPortal();
  if (portal.kind !== "ok" || !portal.access.clientId) return null;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return null;
  const [{ data: ticket }, { data: messages }] = await Promise.all([
    supabase.from("support_tickets").select("id, title, description, status, priority, created_at, resolution").eq("id", ticketId).eq("client_id", portal.access.clientId).maybeSingle(),
    supabase.from("support_ticket_messages").select("id, author_kind, body, created_at").eq("ticket_id", ticketId).eq("audience", "client").order("created_at"),
  ]);
  if (!ticket) notFound();
  return <div className="space-y-5"><Button asChild variant="ghost" size="sm"><Link href="/client/support"><ArrowLeft aria-hidden="true" />All requests</Link></Button><header className="border-b pb-5"><div className="flex flex-wrap items-center gap-2"><h1 className="text-xl font-semibold">{ticket.title}</h1><Badge variant="outline">{supportStatusLabel(ticket.status)}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{supportReference(ticket.id)} · Opened {new Date(ticket.created_at).toLocaleString()}</p></header><section className="space-y-3">{(messages ?? []).map((message) => <article key={message.id} className="rounded-lg border bg-card p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">{message.author_kind === "client" ? "You" : portal.branding.partnerName}</p><time className="text-xs text-muted-foreground">{new Date(message.created_at).toLocaleString()}</time></div><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.body}</p></article>)}</section>{ticket.resolution ? <section className="rounded-lg border border-primary/30 bg-primary/5 p-4"><p className="text-sm font-semibold">Resolution</p><p className="mt-1 text-sm leading-6">{ticket.resolution}</p></section> : null}{!['resolved','closed'].includes(ticket.status) ? <form action={addClientSupportMessage} className="rounded-lg border bg-card p-4"><input type="hidden" name="ticket_id" value={ticket.id} /><Textarea name="body" required rows={4} maxLength={4000} placeholder="Add more information or answer a question" /><Button type="submit" className="mt-3">Send reply</Button></form> : null}</div>;
}
