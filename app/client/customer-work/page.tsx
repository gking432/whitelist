import Link from "next/link";
import { redirect } from "next/navigation";
import { CustomerJourneyWorkspace } from "@/components/business/customer-journey";
import { loadClientPortal } from "@/lib/clients/portal";
import { canReadBusinessWorkspace } from "@/lib/business/access";
import { invalidJourneyFilter, type JourneyFilter } from "@/lib/business/customer-journey-presentation";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Customer work" } };
export default async function CustomerWorkPage({ searchParams }: { searchParams: Promise<JourneyFilter> }) {
  const portal = await loadClientPortal();
  if (portal.kind !== "ok") return null;
  if (!canReadBusinessWorkspace(portal.access)) redirect("/client");
  const filter = await searchParams;
  if (invalidJourneyFilter(filter)) return <p role="alert" className="p-5 text-sm">Choose a valid customer work link from Messages or To-do.</p>;
  return <div className="mx-auto max-w-4xl space-y-7"><div className="flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-medium tracking-tight">Customer work</h1><Link href="/client/messages" className="text-xs text-slate-500 underline">Open Messages</Link></div><p className="text-sm leading-7 text-slate-600">Follow the same customer from inquiry to the next real decision, with source evidence for saved work and verified outcomes.</p><CustomerJourneyWorkspace filter={filter} timeZone={portal.client.timezone} /></div>;
}
