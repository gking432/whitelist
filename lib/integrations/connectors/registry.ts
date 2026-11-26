import { validateConnectorAdapter } from "./contract.ts";
import type {
  ConnectorAdapter,
  ConnectorManifest,
} from "./types.ts";

const adapters = new Map<string, ConnectorAdapter>();

export function registerConnector(adapter: ConnectorAdapter): void {
  const issues = validateConnectorAdapter(adapter);

  if (issues.length > 0) {
    throw new Error(
      `Connector ${adapter.manifest.key || "unknown"} failed its contract: ${issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (adapters.has(adapter.manifest.key)) {
    throw new Error(`Connector ${adapter.manifest.key} is already registered.`);
  }

  adapters.set(adapter.manifest.key, adapter);
}

export function getConnector(key: string): ConnectorAdapter | null {
  return adapters.get(key) ?? null;
}

export function listRegisteredConnectorManifests(): ConnectorManifest[] {
  return [...adapters.values()]
    .map((adapter) => adapter.manifest)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function clearConnectorRegistryForTests(): void {
  adapters.clear();
}
