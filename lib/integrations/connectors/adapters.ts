import { googleWorkspaceAdapter } from "../providers/google-workspace";
import { microsoft365Adapter } from "../providers/microsoft-365";
import type { ConnectorAdapter } from "./types";

const ADAPTERS: Record<string, ConnectorAdapter> = {
  google_workspace: googleWorkspaceAdapter as ConnectorAdapter,
  microsoft_365: microsoft365Adapter as ConnectorAdapter,
};

export function getConnectorAdapter(providerKey: string): ConnectorAdapter | null {
  return ADAPTERS[providerKey] ?? null;
}
