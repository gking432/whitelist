import type { ConnectedData } from "@/lib/connections/types";
import type { ConnectedCrmDeal } from "@/lib/crm/provider-contract";
import { associatedCrmDeals, crmDealAmount, crmSourceTime, hubspotSourceHref } from "@/lib/crm/gateway-presentation";
import { CrmGatewayReviewWidget } from "./crm-gateway-review";

function DealSource({ deal, timeZone }: { deal: ConnectedCrmDeal; timeZone: string }) {
  const href = hubspotSourceHref(deal.href, deal.accountId);
  return <article className="space-y-1 py-3">
    <p className="break-words text-sm">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{deal.name} ↗</a> : deal.name}</p>
    <p className="text-xs leading-6 text-slate-500">{deal.account} · {deal.archived ? "Archived" : deal.stage || "Stage unavailable"}{deal.pipeline ? ` · ${deal.pipeline}` : ""}</p>
    <p className="text-xs leading-6 text-slate-600">Source deal amount: {crmDealAmount(deal.amount, deal.currency)}. Pipeline context, not collected money.</p>
    <p className="text-[11px] leading-6 text-slate-500">Observed {crmSourceTime(deal.observedAt, timeZone) || "at an unavailable source time"}{deal.associationsPartial ? " · Contact associations are incomplete." : ""}</p>
  </article>;
}

export function ConnectedCustomers({ data, timeZone, canWrite = false, sourceRunId }: { data: ConnectedData; timeZone: string; canWrite?: boolean; sourceRunId?: string }) {
  const customers = data.customers ?? [];
  const deals = data.crmDeals ?? [];
  const accounts = data.apps.filter((app) => app.provider === "hubspot");
  const warnings = accounts.flatMap((app) => {
    const streams = app.streams?.filter((stream) => ["customer", "contact", "lead", "deal", "note"].includes(stream.key)) ?? [];
    if (streams.length) return streams.filter((stream) => stream.status !== "fresh" || stream.partial).map((stream) => `${app.account || app.name}: ${stream.detail || `${stream.key} import is ${stream.status}.`}`);
    return app.paused || app.stale || app.error || !app.lastSyncedAt || app.status !== "connected" ? [`${app.account || app.name}: ${app.error || "Customer context is paused, incomplete or delayed."}`] : [];
  });
  return <section className="mt-8 space-y-5 border-t border-slate-200 pt-6" aria-label="Connected customer context">
    <div><h2 className="text-lg font-medium">Customer context from HubSpot</h2><p className="mt-2 text-xs leading-6 text-slate-500">HubSpot keeps the authoritative customer records. Imported contact details and deal associations provide source context; they do not establish identity, permission for outreach or paid revenue.</p></div>
    {warnings.length ? <p className="text-xs leading-6 text-amber-800">{warnings.join(" ")}</p> : null}
    {customers.length ? <section aria-label="Imported HubSpot contacts" className="divide-y divide-slate-100">{customers.slice(0, 50).map((contact) => {
      const href = hubspotSourceHref(contact.href, contact.accountId);
      const associated = associatedCrmDeals(contact, deals);
      return <article key={`${contact.connectionId}:${contact.id}`} className="space-y-2 py-5">
        <h3 className="break-words text-sm font-medium">{href ? <a href={href} target="_blank" rel="noopener noreferrer" className="underline">{contact.name} ↗</a> : contact.name}</h3>
        <p className="text-xs leading-6 text-slate-500">{contact.account} · {contact.archived ? "Archived" : contact.lifecycleStage || "Lifecycle stage unavailable"}</p>
        <p className="break-words text-xs leading-6 text-slate-600">{contact.email || "Email not supplied"} · {contact.phone || "Phone not supplied"}</p>
        <p className="text-[11px] leading-6 text-slate-500">Source updated {crmSourceTime(contact.sourceUpdatedAt, timeZone) || "at an unavailable time"} · Observed {crmSourceTime(contact.observedAt, timeZone) || "at an unavailable time"}</p>
        <details className="text-[11px] leading-6 text-slate-500"><summary className="cursor-pointer">Exact source identity</summary><p className="break-all">HubSpot account {contact.accountId} · Contact {contact.externalId} · Imported record {contact.id}</p></details>
        {associated.length ? <details className="text-xs leading-6"><summary className="cursor-pointer text-slate-600">Source-associated deals · {associated.length}</summary><div className="divide-y divide-slate-100 pl-3">{associated.map((deal) => <DealSource key={`${deal.connectionId}:${deal.id}`} deal={deal} timeZone={timeZone} />)}</div></details> : null}
        {canWrite ? <CrmGatewayReviewWidget connectionId={contact.connectionId} recordId={contact.id} timeZone={timeZone} sourceRunId={sourceRunId} /> : null}
      </article>;
    })}</section> : <p className="text-sm leading-7 text-slate-500">No imported HubSpot customer records are available yet. Connect your business-owned account above and check its import status. This workspace does not provision a HubSpot account.</p>}
    {deals.length ? <section aria-label="Imported HubSpot deal context"><h3 className="text-sm font-medium">Deal context</h3><div className="mt-2 divide-y divide-slate-100">{deals.slice(0, 50).map((deal) => <DealSource key={`${deal.connectionId}:${deal.id}`} deal={deal} timeZone={timeZone} />)}</div></section> : null}
    <p className="text-xs leading-6 text-slate-500">{data.limited || customers.length > 50 || deals.length > 50 ? "This is a bounded set of imported records. " : ""}Current controls support deliberately new HubSpot customers and notes for exact source contacts. Contact field corrections, merges and deal changes are made in HubSpot.</p>
  </section>;
}
