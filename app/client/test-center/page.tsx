import { PackageOpen } from "lucide-react";

import { TestCenter, type TestCenterItem } from "@/components/testing/test-center";
import { loadClientPortal } from "@/lib/clients/portal";
import { loadClientLaunchContext } from "@/lib/launch/context";
import { CAPABILITIES, enabledCapabilityKeys } from "@/lib/packages/capabilities";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { featureTestsForCapabilities } from "@/lib/testing/test-center";

export const metadata = { title: "Test Center" };
export const dynamic = "force-dynamic";

export default async function ClientTestCenterPage() {
  const portal = await loadClientPortal();
  if (
    portal.kind !== "ok" ||
    !portal.access.partnerId ||
    !portal.access.clientId
  ) {
    return null;
  }

  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const context = await loadClientLaunchContext(admin, {
    partnerId: portal.access.partnerId,
    clientId: portal.access.clientId,
  });

  if (!context.package) {
    return (
      <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
        <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
        <h1 className="mt-3 font-semibold">Test Center not configured</h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Your service partner needs to assign the implemented package first.
        </p>
      </section>
    );
  }

  const { data: runData } = await admin
    .from("client_feature_test_runs")
    .select("capability_key, status, completed_at, created_at")
    .eq("client_id", portal.access.clientId)
    .order("created_at", { ascending: false });
  const latestByCapability = new Map<string, { status: string; at: string | null }>();

  for (const run of runData ?? []) {
    if (!latestByCapability.has(run.capability_key)) {
      latestByCapability.set(run.capability_key, {
        status: run.status,
        at: run.completed_at ?? run.created_at,
      });
    }
  }

  const capabilityKeys = enabledCapabilityKeys(context.package.capabilities);
  const items: TestCenterItem[] = featureTestsForCapabilities(capabilityKeys).map(
    (definition) => {
      const capability = CAPABILITIES[definition.capabilityKey];
      const latest = latestByCapability.get(definition.capabilityKey);
      return {
        ...definition,
        label: capability.label,
        capabilityStatus: capability.status,
        statusNote: capability.statusNote,
        latestStatus:
          latest?.status === "passed" || latest?.status === "failed"
            ? latest.status
            : null,
        latestAt: latest?.at ?? null,
      };
    },
  );

  return (
    <TestCenter
      businessName={context.client.name}
      packageName={context.package.name}
      items={items}
      audience="client"
      clientId={portal.access.clientId}
      canRun={portal.access.canOperateCustomerActions}
      isLive={context.readiness.hasLiveRuntime}
      activityHref="/client/activity"
    />
  );
}
