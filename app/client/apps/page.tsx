import { redirect } from "next/navigation";
import { connectionsContext } from "@/lib/connections/context";
import { readConnectedData } from "@/lib/connections/data";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getGoogleOAuthClient } from "@/lib/env";
import { readOwnerProviderOptions } from "@/lib/connections/provider-options";
import { canWriteBusinessWorkspace } from "@/lib/business/access";
import { ConnectedApps } from "@/components/business/connected-apps";
import { crmSourceRunId } from "@/lib/crm/gateway-presentation";
export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "Apps & connections" } };
export default async function AppsPage({
  searchParams,
}: {
  searchParams: Promise<{ connection?: string | string[]; crmRun?: string | string[] }>;
}) {
  const ctx = await connectionsContext();
  if (!ctx) redirect("/client");
  const admin = createSupabaseAdminClient();
  if (!admin) return <p role="alert">The data service is unavailable.</p>;
  const params = await searchParams;
  const sourceRunId = crmSourceRunId(params.crmRun);
  return (
    <ConnectedApps
      timeZone={ctx.portal.client.timezone}
      snapshot={{
        ...(await readConnectedData(admin, ctx.scope)),
        googleAvailable: !!getGoogleOAuthClient(),
        providers: readOwnerProviderOptions(),
        canWrite:
          canWriteBusinessWorkspace(ctx.portal.access) &&
          !ctx.portal.access.isImpersonating,
      }}
      outcome={typeof params.connection === "string" ? params.connection : undefined}
      sourceRunId={sourceRunId}
      invalidSourceRun={params.crmRun !== undefined && !sourceRunId}
    />
  );
}
