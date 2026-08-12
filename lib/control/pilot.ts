import { enabledCapabilityKeys } from "../packages/capabilities.ts";

export type PilotPackageSummary = {
  id: string;
  name: string;
  capabilities: Record<string, unknown> | null;
};

export type PilotClientCandidate = {
  id: string;
  partnerId: string;
  name: string;
  isTestAccount: boolean;
  packageId: string | null;
};

export function selectFullPilotClient(
  clients: PilotClientCandidate[],
  packages: PilotPackageSummary[],
) {
  const packageById = new Map(packages.map((item) => [item.id, item]));

  return clients
    .filter((client) => client.isTestAccount)
    .map((client) => {
      const assignedPackage = client.packageId
        ? packageById.get(client.packageId) ?? null
        : null;
      const capabilityKeys = enabledCapabilityKeys(
        assignedPackage?.capabilities,
      );

      return { client, assignedPackage, capabilityKeys };
    })
    .sort((left, right) => {
      const capabilityDifference =
        right.capabilityKeys.length - left.capabilityKeys.length;

      return capabilityDifference || left.client.name.localeCompare(right.client.name);
    })[0] ?? null;
}

export type PilotUrlState = {
  url: string;
  ready: boolean;
  label: string;
  detail: string;
};

export function classifyPilotAppUrl(value: string): PilotUrlState {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    const temporary = url.hostname.endsWith("trycloudflare.com");
    const ready = url.protocol === "https:" && !local && !temporary;

    return {
      url: value,
      ready,
      label: ready ? "Stable public URL" : temporary ? "Temporary tunnel" : "Local only",
      detail: ready
        ? "OAuth callbacks and provider webhooks can safely use this address."
        : temporary
          ? "Useful for viewing, but the address can change and should not own production OAuth or webhooks."
          : "Deploy before connecting Google OAuth, Twilio webhooks, or automation bridges.",
    };
  } catch {
    return {
      url: value,
      ready: false,
      label: "Invalid app URL",
      detail: "Set APP_URL to the deployed HTTPS address.",
    };
  }
}
