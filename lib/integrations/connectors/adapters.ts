import { googleWorkspaceAdapter } from "../providers/google-workspace";
import { microsoft365Adapter } from "../providers/microsoft-365";
import { housecallProAdapter } from "../providers/housecall-pro";
import { jobberAdapter } from "../providers/jobber";
import { serviceTitanAdapter } from "../providers/servicetitan";
import { workizAdapter } from "../providers/workiz";
import type { ConnectorAdapter } from "./types";

const ADAPTERS: Record<string, ConnectorAdapter> = {
  google_workspace: googleWorkspaceAdapter as ConnectorAdapter,
  microsoft_365: microsoft365Adapter as ConnectorAdapter,
  housecall_pro: housecallProAdapter as ConnectorAdapter,
  jobber: jobberAdapter as ConnectorAdapter,
  servicetitan: serviceTitanAdapter as ConnectorAdapter,
  workiz: workizAdapter as ConnectorAdapter,
};

export function getConnectorAdapter(providerKey: string): ConnectorAdapter | null {
  return ADAPTERS[providerKey] ?? null;
}
