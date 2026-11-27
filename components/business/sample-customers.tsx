"use client";

import Link from "next/link";
import { useState } from "react";
import { CalendarDays, FileText, ListTodo, Mail, MessageSquare } from "lucide-react";
import type { DailyBriefData } from "@/lib/business/daily-brief";
import { validTimeZone } from "@/lib/business/daily-brief";
import { formatMinorMoney } from "@/lib/connections/money";
import { OwnerAreaHeader } from "./owner-ui";
import type { ConversationSnapshot } from "@/lib/conversations/types";

const card = "rounded-2xl border border-slate-200/80 bg-white shadow-[0_12px_32px_-26px_rgba(15,23,42,0.38)]";

function when(value: string, timeZone: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { timeZone: validTimeZone(timeZone), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
    : value;
}

/**
 * One customer, every department: the sample shows how decisions, messages,
 * appointments, tasks and money for the same person come together.
 */
export function SampleCustomers({ data, conversations, summaries }: {
  data: DailyBriefData;
  conversations: ConversationSnapshot;
  summaries: Record<string, string>;
}) {
  const customers = data.connectedData?.customers ?? [];
  const [selectedId, setSelectedId] = useState(customers[0]?.id ?? "");
  const selected = customers.find((item) => item.id === selectedId) ?? customers[0];
  if (!selected) return <OwnerAreaHeader title="Customers" />;
  const first = selected.name.split(/\s+/)[0] ?? selected.name;
  const mentions = (text: string | null | undefined) => !!text && (text.includes(first) || (!!selected.email && text.includes(selected.email)));
  const contact = data.workspace.contacts.find((item) => item.email === selected.email);
  const threads = conversations.conversations.filter((item) => contact && item.contact_id === contact.id);
  const messages = conversations.messages.filter((item) => threads.some((thread) => thread.id === item.conversation_id));
  const decisions = data.approvals.filter((item) => item.proposed_payload?.to === selected.email || mentions(item.title));
  const appointments = data.appointments.filter((item) => mentions(item.title));
  const tasks = data.tasks.filter((item) => mentions(item.title));
  const invoices = (data.connectedData?.invoices ?? []).filter((item) => item.account === selected.name);
  const done = data.work.filter((item) => mentions(item.title) || mentions(item.summary)).slice(0, 4);

  return <div className="space-y-6">
    <div>
      <OwnerAreaHeader title="Customers" />
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">Everything about one customer in one place: what they asked, what is waiting on you, what is booked and what the agents already did.</p>
    </div>
    <div className="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <ul className={`${card} h-fit divide-y divide-slate-100 p-2`} aria-label="Customers">
        {customers.map((customer) => {
          const pending = data.approvals.some((item) => item.proposed_payload?.to === customer.email);
          return <li key={customer.id}>
            <button type="button" onClick={() => setSelectedId(customer.id)} aria-current={customer.id === selected.id ? "true" : undefined}
              className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-sm ${customer.id === selected.id ? "bg-blue-50" : "hover:bg-slate-50"} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600`}>
              <span><span className="block font-medium text-slate-900">{customer.name}</span><span className="text-xs capitalize text-slate-500">{customer.lifecycleStage ?? "contact"}</span></span>
              {pending ? <span className="mt-0.5 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-medium text-white">Needs you</span> : null}
            </button>
          </li>;
        })}
      </ul>
      <section className={`${card} p-6`} aria-labelledby="customer-name">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="customer-name" className="text-xl font-semibold tracking-tight text-slate-950">{selected.name}</h2>
            <p className="mt-1 text-sm text-slate-500"><span className="capitalize">{selected.lifecycleStage ?? "Contact"}</span>{selected.email ? ` · ${selected.email}` : ""}</p>
          </div>
          <Link href="/preview/messages" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"><Mail aria-hidden className="size-4" />Message</Link>
        </div>
        {summaries[selected.name] ? <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">{summaries[selected.name]}</p> : null}

        {decisions.length ? <div className="mt-6">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-blue-700">Waiting on you</h3>
          <ul className="mt-2 space-y-2">{decisions.map((item) => <li key={item.id} className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3">
            <p className="text-sm font-medium text-slate-900">{item.title}</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">{String(item.proposed_payload?.decision_prompt ?? item.summary ?? "")}</p>
            <Link href="/preview" className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline">Decide on Today</Link>
          </li>)}</ul>
        </div> : null}

        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Block icon={MessageSquare} title="Conversation" empty="No messages yet.">
            {messages.slice(-3).map((item) => <li key={item.id} className="text-sm leading-6"><span className="text-xs text-slate-400">{item.direction === "inbound" ? first : "You"} · {when(item.created_at, data.timeZone)}</span><br />{item.body}</li>)}
          </Block>
          <Block icon={CalendarDays} title="Appointments" empty="Nothing booked.">
            {appointments.map((item) => <li key={item.id} className="text-sm"><span className="font-medium text-slate-800">{item.title}</span><br /><span className="text-slate-500">{when(item.start_at, data.timeZone)}</span></li>)}
          </Block>
          <Block icon={ListTodo} title="Tasks" empty="No open tasks.">
            {tasks.map((item) => <li key={item.id} className="text-sm text-slate-800">{item.title}</li>)}
          </Block>
          <Block icon={FileText} title="Money" empty="No invoices.">
            {invoices.map((item) => <li key={item.id} className="text-sm text-slate-800">{item.number} · {formatMinorMoney(item.amountDueMinor, item.currency)} · {item.status?.replace("_", " ")}</li>)}
          </Block>
        </div>

        {done.length ? <div className="mt-6 border-t border-slate-100 pt-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Done by agents</h3>
          <ul className="mt-2 space-y-2">{done.map((item) => <li key={item.id} className="text-sm text-slate-700"><span className="font-medium">{item.title}</span>{item.summary ? ` — ${item.summary}` : ""}</li>)}</ul>
        </div> : null}
      </section>
    </div>
  </div>;
}

function Block({ icon: Icon, title, empty, children }: { icon: typeof Mail; title: string; empty: string; children: React.ReactNode[] }) {
  return <div>
    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"><Icon aria-hidden className="size-3.5" />{title}</h3>
    {children.length ? <ul className="mt-2 space-y-2">{children}</ul> : <p className="mt-2 text-sm text-slate-400">{empty}</p>}
  </div>;
}
