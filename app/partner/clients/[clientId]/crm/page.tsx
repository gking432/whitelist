import Link from "next/link";
import { ContactRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { formatDateTime, formatEnum } from "@/lib/format";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Built-in CRM",
};

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ clientId: string }>;
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  created_at: string;
};

type LeadRow = {
  id: string;
  contact_id: string;
  status: string;
  urgency: string | null;
  quality: string | null;
};

const INTERNAL_MODES = new Set(["primary_crm", "mirror", "assist"]);

export default async function BuiltinCrmPage({ params }: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);

  if (workspace.kind !== "ok") {
    return null;
  }

  const { client } = workspace;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const usesInternalCrm = INTERNAL_MODES.has(client.crm_operating_mode);

  const [{ data: contactsData }, { data: leadsData }, { data: tasksData }] =
    await Promise.all([
      supabase
        .from("crm_contacts")
        .select("id, first_name, last_name, email, phone, source, created_at")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("crm_leads")
        .select("id, contact_id, status, urgency, quality")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("crm_tasks")
        .select("id, title, priority, status, due_at, contact_id")
        .eq("client_id", clientId)
        .eq("status", "open")
        .order("due_at", { ascending: true })
        .limit(20),
    ]);

  const contacts = (contactsData ?? []) as ContactRow[];
  const leads = (leadsData ?? []) as LeadRow[];
  const tasks = (tasksData ?? []) as {
    id: string;
    title: string;
    priority: string;
    status: string;
    due_at: string | null;
    contact_id: string | null;
  }[];

  const leadsByContact = new Map<string, LeadRow[]>();

  for (const lead of leads) {
    const list = leadsByContact.get(lead.contact_id) ?? [];
    list.push(lead);
    leadsByContact.set(lead.contact_id, list);
  }

  const base = `/partner/clients/${clientId}/crm`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">Built-in CRM</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
          Northstar&apos;s own contacts, leads, tasks, and timeline for this
          client. CRM operating mode:{" "}
          <Badge variant="outline">
            {formatEnum(client.crm_operating_mode)}
          </Badge>
          {usesInternalCrm ? (
            <> — leads and AI activity are recorded here automatically.</>
          ) : (
            <>
              {" "}
              — this client runs on their external CRM, so the built-in CRM
              stays empty. Change the operating mode in Settings to mirror or
              use it.
            </>
          )}
        </p>
      </div>

      {tasks.length > 0 ? (
        <section className="rounded-lg border bg-card p-5">
          <h3 className="text-sm font-semibold">Open follow-up tasks</h3>
          <ul className="mt-2 space-y-1.5 text-sm">
            {tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{formatEnum(task.priority)}</Badge>
                <span>{task.title}</span>
                {task.due_at ? (
                  <span className="text-xs text-muted-foreground">
                    due {formatDateTime(task.due_at)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contacts.length === 0 ? (
        <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
          <ContactRound
            className="size-6 text-muted-foreground"
            aria-hidden="true"
          />
          <h3 className="mt-3 text-sm font-semibold">No contacts yet</h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            {usesInternalCrm
              ? "Contacts appear automatically when leads come through intake."
              : "Switch the CRM operating mode to primary, mirror, or assist to fill the built-in CRM."}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Reach</th>
                  <th className="px-4 py-3 font-medium">Leads</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Added</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {contacts.map((contact) => {
                  const contactLeads = leadsByContact.get(contact.id) ?? [];
                  const name =
                    [contact.first_name, contact.last_name]
                      .filter(Boolean)
                      .join(" ") || "Unnamed contact";

                  return (
                    <tr key={contact.id} className="hover:bg-secondary/30">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`${base}/${contact.id}`}
                          className="font-medium hover:underline"
                        >
                          {name}
                        </Link>
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {[contact.phone, contact.email]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-4 py-3.5">
                        {contactLeads.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="flex flex-wrap gap-1">
                            {contactLeads.slice(0, 3).map((lead) => (
                              <Badge key={lead.id} variant="outline">
                                {formatEnum(lead.status)}
                                {lead.urgency ? ` · ${lead.urgency}` : ""}
                              </Badge>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {contact.source ?? "—"}
                      </td>
                      <td className="px-4 py-3.5 text-muted-foreground">
                        {formatDateTime(contact.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
