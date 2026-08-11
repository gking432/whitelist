import { googleWorkspaceAdapter } from "../providers/google-workspace";
import { microsoft365Adapter } from "../providers/microsoft-365";
import { housecallProAdapter } from "../providers/housecall-pro";
import { jobberAdapter } from "../providers/jobber";
import { serviceTitanAdapter } from "../providers/servicetitan";
import { workizAdapter } from "../providers/workiz";
import { quickBooksOnlineAdapter } from "../providers/quickbooks-online";
import { stripeAdapter } from "../providers/stripe";
import { squareAdapter } from "../providers/square";
import { callRailAdapter } from "../providers/callrail";
import { ringCentralAdapter } from "../providers/ringcentral";
import { dialpadAdapter } from "../providers/dialpad";
import { openPhoneAdapter } from "../providers/openphone";
import { metaAdapter } from "../providers/meta";
import { googleAdsAdapter } from "../providers/google-ads";
import { googleBusinessProfileAdapter } from "../providers/google-business-profile";
import { podiumAdapter } from "../providers/podium";
import { birdeyeAdapter } from "../providers/birdeye";
import type { ConnectorAdapter } from "./types";

const ADAPTERS: Record<string, ConnectorAdapter> = {
  google_workspace: googleWorkspaceAdapter as ConnectorAdapter,
  microsoft_365: microsoft365Adapter as ConnectorAdapter,
  housecall_pro: housecallProAdapter as ConnectorAdapter,
  jobber: jobberAdapter as ConnectorAdapter,
  servicetitan: serviceTitanAdapter as ConnectorAdapter,
  workiz: workizAdapter as ConnectorAdapter,
  quickbooks_online: quickBooksOnlineAdapter as ConnectorAdapter,
  stripe: stripeAdapter as ConnectorAdapter,
  square: squareAdapter as ConnectorAdapter,
  callrail: callRailAdapter as ConnectorAdapter,
  ringcentral: ringCentralAdapter as ConnectorAdapter,
  dialpad: dialpadAdapter as ConnectorAdapter,
  openphone: openPhoneAdapter as ConnectorAdapter,
  meta: metaAdapter as ConnectorAdapter,
  google_ads: googleAdsAdapter as ConnectorAdapter,
  google_business_profile: googleBusinessProfileAdapter as ConnectorAdapter,
  podium: podiumAdapter as ConnectorAdapter,
  birdeye: birdeyeAdapter as ConnectorAdapter,
};

export function getConnectorAdapter(providerKey: string): ConnectorAdapter | null {
  return ADAPTERS[providerKey] ?? null;
}
