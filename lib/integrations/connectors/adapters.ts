import { googleWorkspaceAdapter } from "../providers/google-workspace.ts";
import { microsoft365Adapter } from "../providers/microsoft-365.ts";
import { housecallProAdapter } from "../providers/housecall-pro.ts";
import { jobberAdapter } from "../providers/jobber.ts";
import { serviceTitanAdapter } from "../providers/servicetitan.ts";
import { workizAdapter } from "../providers/workiz.ts";
import { quickBooksOnlineAdapter } from "../providers/quickbooks-online.ts";
import { stripeAdapter } from "../providers/stripe.ts";
import { squareAdapter } from "../providers/square.ts";
import { callRailAdapter } from "../providers/callrail.ts";
import { ringCentralAdapter } from "../providers/ringcentral.ts";
import { dialpadAdapter } from "../providers/dialpad.ts";
import { openPhoneAdapter } from "../providers/openphone.ts";
import { metaAdapter } from "../providers/meta.ts";
import { googleAdsAdapter } from "../providers/google-ads.ts";
import { googleBusinessProfileAdapter } from "../providers/google-business-profile.ts";
import { podiumAdapter } from "../providers/podium.ts";
import { birdeyeAdapter } from "../providers/birdeye.ts";
import type { ConnectorAdapter, ConnectorCapability } from "./types.ts";

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

export function listConnectorAdapters(): ConnectorAdapter[] {
  return Object.values(ADAPTERS);
}

// These providers use purpose-built execution paths instead of the generic
// pull/push adapter. Keeping their exact capabilities here lets release tests
// reject a verified catalog claim that has no runtime implementation.
export const NATIVE_CONNECTOR_CAPABILITIES = {
  twilio: ["lead.webhook", "message.create", "message.webhook"],
  resend: ["message.create"],
  google_calendar: ["appointment.read", "appointment.create"],
  northstar_web_chat: ["lead.webhook", "message.webhook"],
  generic_inbound_webhook: ["lead.webhook"],
  generic_outbound_webhook: ["customer.create", "note.create"],
  universal_lead_email: ["lead.webhook"],
  hubspot: [
    "customer.search",
    "customer.create",
    "customer.update",
    "note.create",
  ],
  gohighlevel: [
    "customer.search",
    "customer.create",
    "customer.update",
    "note.create",
  ],
} as const satisfies Record<string, readonly ConnectorCapability[]>;
