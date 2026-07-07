import Link from "next/link";
import { ArrowLeft, Bot, CalendarClock, User } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Contact",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string; contactId: string }>;
};

export default async function ContactDetailPage({ params }: PageProps) {
  const { clientId, contactId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const [
    { data: contact },
    { data: leadsData },
    { data: timelineData },
    { data: tasksData },
    { data: appointmentsData },
  ] = await Promise.all([
    supabase
      .from("crm_contacts")
      .select("*")
      .eq("id", contactId)
      .eq("client_id", clientId)
      .maybeSingle(),
    supabase
      .from("crm_leads")
      .select("id, status, urgency, quality, summary, created_at")
      .eq("contact_id", contactId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false }),
    supabase
      .from("crm_timeline_entries")
      .select("id, kind, actor_type, title, body, created_at, ref_run_id")
      .eq("contact_id", contactId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("crm_tasks")
      .select("id, title, priority, status, due_at")
      .eq("contact_id", contactId)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("crm_appointments")
      .select("id, title, start_at, end_at, status, external_ref")
      .eq("contact_id", contactId)
      .eq("client_id", clientId)
      .order("start_at", { ascending: false })
      .limit(20),
  ]);

  if (!contact) {
    return (
      <section className="rounded-lg border bg-card p-6">
        <h2 className="font-semibold">Contact not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          <Link
            href={`/partner/clients/${clientId}/crm`}
            className="underline"
          >
            Back to the built-in CRM
          </Link>
        </p>
      </section>
    );
  }

  const name =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
    "Unnamed contact";
  const leads = leadsData ?? [];
  const timeline = timelineData ?? [];
  const tasks = tasksData ?? [];
  const appointments = appointmentsData ?? [];

  return (
    <div className="space-y-5">
      <div>
        <Link
          href={`/partner/clients/${clientId}/crm`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to contacts
        </Link>
        <h2 className="mt-2 font-semibold">{name}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {[contact.phone, contact.email, contact.address]
            .filter(Boolean)
            .join(" · ") || "No contact details on file."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Leads</h3>
          {leads.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No leads yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {leads.map((lead) => (
                <li key={lead.id} className="rounded-md border bg-background p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">{formatEnum(lead.status)}</Badge>
                    {lead.urgency ? (
                      <Badge variant="outline">{formatEnum(lead.urgency)} urgency</Badge>
                    ) : null}
                    {lead.quality ? (
                      <Badge variant="outline">{formatEnum(lead.quality)}</Badge>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {formatDateTime(lead.created_at)}
                    </span>
                  </div>
                  {lead.summary ? (
                    <p className="mt-1.5 text-xs leading-5 text-muted-foreground">
                      {lead.summary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Tasks & appointments</h3>
          {tasks.length === 0 && appointments.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              Nothing scheduled yet.
            </p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {appointments.map((appointment) => (
                <li key={appointment.id} className="flex items-start gap-2">
                  <CalendarClock
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-medium">{appointment.title}</span>{" "}
                    <Badge variant="outline">
                      {formatEnum(appointment.status)}
                    </Badge>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateTime(appointment.start_at)} –{" "}
                      {formatDateTime(appointment.end_at)}
                    </span>
                  </span>
                </li>
              ))}
              {tasks.map((task) => (
                <li key={task.id} className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">
                    {formatEnum(task.priority)}
                  </Badge>
                  <span>
                    <span
                      className={
                        task.status !== "open"
                          ? "text-muted-foreground line-through"
                          : ""
                      }
                    >
                      {task.title}
                    </span>
                    {task.due_at ? (
                      <span className="block text-xs text-muted-foreground">
                        due {formatDateTime(task.due_at)}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="rounded-lg border bg-card p-5">
        <h3 className="text-sm font-semibold">Timeline</h3>
        {timeline.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No activity recorded yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {timeline.map((entry) => (
              <li key={entry.id} className="flex gap-3">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                  {entry.actor_type === "ai_assistant" ? (
                    <Bot className="size-3.5 text-primary" aria-hidden="true" />
                  ) : (
                    <User
                      className="size-3.5 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="font-medium">{entry.title}</span>{" "}
                    <span className="text-xs text-muted-foreground">
                      · {formatEnum(entry.kind)} ·{" "}
                      {formatDateTime(entry.created_at)}
                    </span>
                  </p>
                  {entry.body ? (
                    <p className="mt-0.5 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {entry.body}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
