import type { ClientStatus } from "../clients/constants.ts";

export type PartnerDeliveryStage =
  | "package"
  | "setup"
  | "test"
  | "launch"
  | "live";

export function resolvePartnerDeliveryStage(input: {
  packageId: string | null;
  runtimeMode: string;
  clientStatus: ClientStatus;
  launchStatus: string | null;
  deploymentStatus: string | null;
}): PartnerDeliveryStage {
  if (
    input.launchStatus === "live" ||
    (input.clientStatus === "active" && input.runtimeMode === "live")
  ) {
    return "live";
  }

  if (!input.packageId) return "package";
  if (input.deploymentStatus !== "ready") return "setup";
  if (input.launchStatus === "ready") return "launch";
  return "test";
}

export function deliveryStageHref(
  clientId: string,
  stage: PartnerDeliveryStage,
): string {
  const base = `/partner/clients/${clientId}`;
  if (stage === "package" || stage === "setup") return `${base}/setup`;
  if (stage === "test") return `${base}/test-center`;
  if (stage === "launch") return `${base}/launch`;
  return `${base}/runs`;
}
