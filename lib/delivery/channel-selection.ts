import type { SupabaseClient } from "@supabase/supabase-js";
import { googleAccountCanAct } from "../connections/google-permissions.ts";

export type DeliveryAccount = {
  id: string; partner_id: string; client_id: string; status: string; runtime_mode: string; credential_status: string;
  error_count: number | null; config: Record<string, unknown> | null; provider: { provider_key: string } | null;
};
export type DeliveryActivation = { status: string; email: boolean; workspace_connection_id: string | null; workspace_provider: string };
export type DeliveryAccountSelection = { connection: DeliveryAccount | null; reason: string };
type SelectionInput = { partnerId: string; clientId: string; channel: "email" | "sms"; connectionId?: string | null; now?: number };
const PROVIDERS = { email: ["google_workspace", "microsoft_365", "resend"], sms: ["twilio"] };

/** Explicit account IDs and the owner's saved workspace choice are bindings,
 * including when unavailable. An unavailable binding never selects a peer. */
export function selectDeliveryAccount(input: SelectionInput, accounts: DeliveryAccount[], activation: DeliveryActivation | null, complete = true): DeliveryAccountSelection {
  const reject = (reason: string): DeliveryAccountSelection => ({ connection: null, reason });
  if (!complete || accounts.length > 100) return reject("Account coverage is incomplete. Review the approved delivery account before retrying.");
  if (accounts.some((row) => row.partner_id !== input.partnerId || row.client_id !== input.clientId)) return reject("Delivery account scope could not be verified.");
  const supported = accounts.filter((row) => PROVIDERS[input.channel].includes(row.provider?.provider_key ?? ""));
  if (input.connectionId !== null && input.connectionId !== undefined) {
    const exact = supported.filter((row) => row.id === input.connectionId && ["connected", "needs_attention"].includes(row.status));
    if (exact.length === 1 && exact[0].config?.workspace_view_only === true &&
      !(input.channel === "email" && exact[0].provider?.provider_key === "google_workspace" && googleAccountCanAct(exact[0].config, "email")))
      return reject("The exact approved account is read only for this channel. No alternative account was selected.");
    // Retain a specifically bound legacy dry-run account. The delivery layer
    // records that honest outcome; final authority checks still guard writes.
    return exact.length === 1 ? { connection: exact[0], reason: "The explicit approved account is retained." } : reject("The exact approved delivery account is unavailable. No alternative account was selected.");
  }
  const live = (row: DeliveryAccount) => row.status === "connected" && row.runtime_mode === "live" && row.credential_status === "configured";
  if (input.channel === "email" && activation?.status === "active" && activation.email && activation.workspace_connection_id) {
    const exact = supported.filter((row) => row.id === activation.workspace_connection_id && row.provider?.provider_key === activation.workspace_provider &&
      ["google_workspace", "microsoft_365"].includes(row.provider?.provider_key ?? ""));
    if (exact.length !== 1 || !live(exact[0])) return reject("The exact selected business email account is unavailable or paused. No alternative account was selected.");
    const row = exact[0], config = row.config ?? {};
    if (config.workspace_view_only === true) {
      const checked = typeof config.activation_checked_at === "string" ? Date.parse(config.activation_checked_at) : NaN, now = input.now ?? Date.now();
      if (row.provider?.provider_key !== "google_workspace" || !googleAccountCanAct(config, "email") || config.activation_selected !== true || config.activation_mail_verified !== true ||
        !Number.isFinite(checked) || !Number.isFinite(now) || checked > now + 60000 || now - checked >= 24 * 60 * 60000)
        return reject("Recheck the exact selected Google email permission before delivery. No alternative account was selected.");
    }
    return { connection: row, reason: "The owner's exact selected business email account is retained." };
  }
  const legacy = supported.filter((row) => live(row) && row.config?.workspace_view_only !== true && row.provider?.provider_key === (input.channel === "email" ? "resend" : "twilio"));
  if (legacy.length !== 1) return reject(legacy.length ? "More than one eligible delivery account exists. Bind an exact account before sending." : "No eligible delivery account is selected. Review business account setup before retrying.");
  return { connection: legacy[0], reason: "One eligible legacy delivery account is available." };
}

/** Tenant/provider filters apply before the deterministic bound. No credential
 * data is selected, and query failures cannot become fallback selection. */
export async function loadDeliveryAccount(admin: SupabaseClient, input: SelectionInput): Promise<DeliveryAccountSelection> {
  let query = admin.from("integration_connections")
    .select("id,partner_id,client_id,runtime_mode,status,credential_status,error_count,config,provider:integration_providers!inner(provider_key)")
    .eq("partner_id", input.partnerId).eq("client_id", input.clientId).in("provider.provider_key", PROVIDERS[input.channel]).in("status", ["connected", "needs_attention"]);
  if (input.connectionId !== null && input.connectionId !== undefined) query = query.eq("id", input.connectionId);
  const [accounts, activation] = await Promise.all([
    query.order("id", { ascending: true }).limit(101),
    input.channel === "email" && !input.connectionId ? admin.from("business_agent_activation").select("status,email,workspace_connection_id,workspace_provider")
      .eq("partner_id", input.partnerId).eq("client_id", input.clientId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (accounts.error || activation.error) return { connection: null, reason: "Current delivery account selection could not be verified. Nothing was sent." };
  return selectDeliveryAccount(input, (accounts.data ?? []) as unknown as DeliveryAccount[], activation.data as DeliveryActivation | null, (accounts.data?.length ?? 0) <= 100);
}
