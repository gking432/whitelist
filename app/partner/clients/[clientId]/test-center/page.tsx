import Link from "next/link";
import { LockKeyhole, PackageOpen } from "lucide-react";

import {
  TestCenter,
  type TestCenterItem,
} from "@/components/testing/test-center";
import { Button } from "@/components/ui/button";
import { loadClientWorkspace } from "@/lib/clients/workspace";
import { loadClientLaunchContext } from "@/lib/launch/context";
import {
  CAPABILITIES,
  enabledCapabilityKeys,
} from "@/lib/packages/capabilities";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadFeatureTestProgress } from "@/lib/testing/progress";
import { featureTestsForCapabilities } from "@/lib/testing/test-center";

export const metadata = { title: "Test Center" };
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ clientId: string }> };

export default async function PartnerClientTestCenterPage({
  params,
}: PageProps) {
  const { clientId } = await params;
  const workspace = await loadClientWorkspace(clientId);
  if (workspace.kind !== "ok" || !workspace.access.partnerId) return null;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const context = await loadClientLaunchContext(admin, {
    partnerId: workspace.access.partnerId,
    clientId,
  });

  if (!context.package) {
    return (
      <section className="flex min-h-56 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
        <PackageOpen
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 font-semibold">No package assigned</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          The Test Center is generated from the package implemented for this
          business.
        </p>
        <Button asChild className="mt-4" size="sm">
          <Link href={`/partner/clients/${clientId}/setup`}>
            Open onboarding
          </Link>
        </Button>
      </section>
    );
  }

  const setupGates = context.readiness.gates.filter(
    (gate) => gate.key !== "tests",
  );
  const setupBlockers = setupGates.filter((gate) => !gate.passed);

  if (setupBlockers.length > 0) {
    return (
      <section className="flex min-h-64 flex-col items-center justify-center rounded-lg border bg-card px-6 py-10 text-center">
        <LockKeyhole
          className="size-6 text-muted-foreground"
          aria-hidden="true"
        />
        <h2 className="mt-3 font-semibold">Finish setup before testing</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          Test Center unlocks after the package, workflows, and required client
          accounts are ready.
        </p>
        <ul className="mt-4 max-w-md space-y-2 text-left text-sm">
          {setupBlockers.map((gate) => (
            <li key={gate.key}>
              <span className="font-medium">{gate.label}:</span>{" "}
              <span className="text-muted-foreground">{gate.detail}</span>
            </li>
          ))}
        </ul>
        <Button asChild className="mt-5" size="sm">
          <Link href={`/partner/clients/${clientId}/setup`}>
            Return to Setup
          </Link>
        </Button>
      </section>
    );
  }

  const capabilityKeys = enabledCapabilityKeys(context.package.capabilities);
  const progress = await loadFeatureTestProgress(admin, {
    clientId,
    packageId: context.package.id,
    capabilityKeys,
  });
  const items: TestCenterItem[] = featureTestsForCapabilities(
    capabilityKeys,
  ).map((definition) => {
    const capability = CAPABILITIES[definition.capabilityKey];
    const latest = progress.latestByCapability.get(definition.capabilityKey);
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
  });

  return (
    <TestCenter
      businessName={context.client.name}
      packageName={context.package.name}
      items={items}
      audience="partner"
      clientId={clientId}
      canRun={workspace.access.canManageWorkflows}
      isLive={context.readiness.hasLiveRuntime}
      activityHref={`/partner/clients/${clientId}/runs`}
      nextHref={`/partner/clients/${clientId}/launch`}
    />
  );
}
