import Link from "next/link";
import { redirect } from "next/navigation";
import { ConnectedMoney } from "@/components/business/connected-money";
import { ConnectedDataRefresh } from "@/components/business/connected-data-refresh";
import { connectionsContext } from "@/lib/connections/context";
import { readConnectedData } from "@/lib/connections/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Money" } };

export default async function MoneyPage() {
  const ctx = await connectionsContext();
  if (!ctx) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p role="alert">The data service is unavailable. Refresh to try again.</p>;
  const data = await readConnectedData(admin, ctx.scope);
  return <div className="max-w-3xl"><ConnectedDataRefresh /><div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-medium tracking-tight">Money</h1><Link href="/client/apps" className="text-xs text-slate-500">Connections ↗</Link></div><p className="mb-8 mt-3 text-sm leading-7 text-slate-500">Invoices and payment records from your connected apps, with their current imported status.</p>{data.errors.length ? <p role="alert" className="mb-6 text-sm text-amber-800">{data.errors.join(" ")}</p> : null}<ConnectedMoney data={data} timeZone={ctx.portal.client.timezone} /></div>;
}
