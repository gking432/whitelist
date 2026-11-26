import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";
import type { InvoiceFollowupPin } from "./contract.ts";
import { invoiceFollowupSourceBlock, readInvoiceFollowupPin } from "./eligibility.ts";
import { readRestrictedStripeInvoice, type StripeCredentials } from "../integrations/providers/stripe.ts";

export type InvoiceFollowupGuardDependencies = {
  now?: () => string;
  readInvoice?: (pin: InvoiceFollowupPin) => Promise<Record<string, unknown>>;
};

async function currentInvoice(admin: SupabaseClient, job: ActionJobRecord, pin: InvoiceFollowupPin) {
  const account = await admin.from("integration_connections")
    .select("id,status,runtime_mode,external_account_id,provider:integration_providers!inner(provider_key)")
    .eq("partner_id", job.partner_id).eq("client_id", job.client_id).eq("id", pin.stripe_connection_id)
    .eq("provider.provider_key", "stripe").maybeSingle();
  if (account.error || !account.data || account.data.status !== "connected" || account.data.runtime_mode === "paused" || account.data.external_account_id !== pin.stripe_account_id)
    throw new Error("The selected Stripe account is paused, unavailable or changed.");
  const { readProviderCredentials } = await import("../integrations/credentials.ts");
  const credentials = await readProviderCredentials<StripeCredentials>(admin, pin.stripe_connection_id);
  if (!credentials) throw new Error("The selected Stripe read credentials are unavailable.");
  const observed = await readRestrictedStripeInvoice(credentials, { accountId: pin.stripe_account_id, invoiceId: pin.invoice_id });
  return { ...observed.invoice.data, deleted: observed.invoice.deleted === true };
}

/** Runs before dispatch and at every provider adapter preflight, including
 * after email token refresh. Remote work is two GETs, never a Stripe effect. */
export async function invoiceFollowupDeliveryBlock(admin: SupabaseClient, job: ActionJobRecord, deps: InvoiceFollowupGuardDependencies = {}): Promise<string | null> {
  if (job.payload.invoice_followup_version === undefined && job.payload.money_review_id === undefined) return null;
  const pin = readInvoiceFollowupPin(job.payload);
  if (!pin || job.kind !== "email.send" || !job.approval_id)
    return "Invalid invoice follow-up decision. Nothing was sent.";
  if (["succeeded", "uncertain", "provider_pending"].includes(job.status) || job.provider_receipt)
    return "This follow-up already has an accepted, uncertain or completed outcome. It must not be resent.";
  const check = async (): Promise<string | null> => {
    const { data, error } = await admin.rpc("invoice_followup_action_check", {
      p_partner: job.partner_id, p_client: job.client_id, p_approval: job.approval_id, p_job: job.id,
    });
    if (error || !data || typeof data.allowed !== "boolean") throw new Error("The current invoice follow-up decision could not be verified.");
    return data.allowed ? null : typeof data.reason === "string" ? data.reason : "The source, recipient, permission or current owner controls changed.";
  };
  const before = await check();
  if (before) return before;
  const facts = await (deps.readInvoice ? deps.readInvoice(pin) : currentInvoice(admin, job, pin));
  const source = invoiceFollowupSourceBlock(pin, facts, deps.now?.() ?? new Date().toISOString());
  if (source) return source;
  return check();
}
