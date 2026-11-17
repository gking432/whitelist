import type { ConnectedApp, ConnectionProviderOption } from "../../lib/connections/types.ts";

/** Match the owner API's supported controls; intake never enters OAuth. */
export function connectionControls(app: ConnectedApp, option?: ConnectionProviderOption) {
  const managed = !!option && (app.readOnly || ["stripe", "generic_inbound_webhook"].includes(app.provider));
  return {
    managed,
    canPause: managed && ["connected", "needs_attention"].includes(app.status),
    canRefresh: managed && option?.setup !== "token" && app.status === "connected",
    reconnect: managed && option?.setup === "oauth",
    secureSetup: managed && option?.setup === "operator",
    disconnect: managed && (!!app.account || ["connected", "needs_attention"].includes(app.status)),
    intake: option?.setup === "token",
  };
}
export function providerConnectLabel(option: ConnectionProviderOption, accounts: ConnectedApp[]) {
  return accounts.some((app) => app.readOnly && app.status === "connected")
    ? "Connect another account" : `Connect ${option.label}`;
}
