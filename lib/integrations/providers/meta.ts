import { connectorHttpError } from "../connectors/errors.ts";
import type { CanonicalObjectType, CanonicalRecord, ConnectorAdapter, ConnectorPage } from "../connectors/types";
import type { MetaCredentials } from "./marketing-oauth";

function version() { return process.env.META_GRAPH_VERSION ?? "v24.0"; }
async function graph(credentials: MetaCredentials, path: string, token = credentials.pageAccessToken, init: RequestInit = {}) { const separator = path.includes("?") ? "&" : "?"; const response = await fetch(`https://graph.facebook.com/${version()}/${path}${separator}access_token=${encodeURIComponent(token)}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(15_000) }); if (!response.ok) throw connectorHttpError("meta", response); return response; }
function fieldMap(value: unknown) { const rows = Array.isArray(value) ? value : []; return Object.fromEntries(rows.map((raw) => { const field = raw as { name?: string; values?: unknown[] }; return [field.name ?? "field", field.values?.[0] ?? null]; })); }
function actionTotal(value: unknown, include: (actionType: string) => boolean) {
  return (Array.isArray(value) ? value : []).reduce((total, raw) => {
    const action = raw as { action_type?: string; value?: string | number };
    return include(action.action_type ?? "") ? total + Number(action.value ?? 0) : total;
  }, 0);
}

export const metaAdapter: ConnectorAdapter<MetaCredentials> = {
  manifest: { key: "meta", name: "Facebook and Instagram", category: "lead_source", description: "Facebook and Instagram Lead Ads plus campaign performance and attribution.", authStrategy: "oauth2", capabilities: ["lead.read", "lead.webhook", "campaign.read"], verificationStatus: "contract_verified", requestable: false, docsUrl: "https://developers.facebook.com/docs/marketing-api/guides/lead-ads" },
  async testConnection(context) { try { await graph(context.credentials, `${context.credentials.pageId}?fields=id,name`); return { ok: true, detail: "Facebook and Instagram connected. Lead Ads can enter the CRM and campaign results can populate marketing reports.", externalAccountId: context.credentials.pageId, externalAccountName: context.credentials.pageName }; } catch (error) { return { ok: false, detail: error instanceof Error ? error.message : "Meta verification failed." }; } },
  async pullPage(context, objectType: CanonicalObjectType, cursor): Promise<ConnectorPage> {
    if (objectType === "lead") {
      const formId = typeof cursor?.formId === "string" ? cursor.formId : null;
      if (!formId) { const forms = await (await graph(context.credentials, `${context.credentials.pageId}/leadgen_forms?fields=id,name&limit=100`)).json() as { data?: { id?: string }[] }; const first = forms.data?.[0]?.id; if (!first) return { records: [], nextCursor: null }; return this.pullPage!(context, objectType, { formId: first, formIds: forms.data?.map((form) => form.id).filter(Boolean), formIndex: 0 }); }
      const query = new URLSearchParams({ fields: "id,created_time,field_data,form_id,ad_id,adset_id,campaign_id", limit: "100", ...(typeof cursor?.after === "string" ? { after: cursor.after } : {}) });
      const body = await (await graph(context.credentials, `${formId}/leads?${query}`)).json() as { data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string }; next?: string } };
      const records: CanonicalRecord[] = (body.data ?? []).map((lead) => { const fields = fieldMap(lead.field_data); return { objectType: "lead", externalId: String(lead.id ?? ""), updatedAt: typeof lead.created_time === "string" ? lead.created_time : null, data: { name: fields.full_name ?? ([fields.first_name, fields.last_name].filter(Boolean).join(" ") || "Meta lead"), email: fields.email ?? null, phone: fields.phone_number ?? null, description: fields.message ?? null, status: "new", source: "meta_lead_ads", medium: "paid_social", campaign: lead.campaign_id ?? null, ad_id: lead.ad_id ?? null }, source: lead }; });
      const formIds = Array.isArray(cursor?.formIds) ? cursor.formIds.filter((value): value is string => typeof value === "string") : [formId]; const formIndex = typeof cursor?.formIndex === "number" ? cursor.formIndex : 0; const after = body.paging?.next ? body.paging.cursors?.after : null;
      return { records, nextCursor: after ? { formId, formIds, formIndex, after } : formIds[formIndex + 1] ? { formId: formIds[formIndex + 1], formIds, formIndex: formIndex + 1 } : null };
    }
    if (objectType !== "campaign") throw new Error(`Meta cannot pull ${objectType}.`);
    if (!context.credentials.adAccountId) return { records: [], nextCursor: null };
    const query = new URLSearchParams({ fields: "campaign_id,campaign_name,impressions,clicks,spend,actions,action_values", date_preset: "last_30d", level: "campaign", limit: "100", ...(typeof cursor?.after === "string" ? { after: cursor.after } : {}) });
    const body = await (await graph(context.credentials, `act_${context.credentials.adAccountId.replace(/^act_/, "")}/insights?${query}`, context.credentials.accessToken)).json() as { data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string }; next?: string } };
    return { records: (body.data ?? []).map((campaign) => {
      const isConversion = (type: string) => type.includes("lead") || type.includes("offsite_conversion") || type.includes("schedule");
      return { objectType: "campaign", externalId: String(campaign.campaign_id ?? ""), data: { name: campaign.campaign_name ?? null, impressions: campaign.impressions ?? 0, clicks: campaign.clicks ?? 0, spend: campaign.spend ?? 0, conversions: actionTotal(campaign.actions, isConversion), conversion_value: actionTotal(campaign.action_values, isConversion), source: "meta" }, source: campaign };
    }), nextCursor: body.paging?.next && body.paging.cursors?.after ? { after: body.paging.cursors.after } : null };
  },
  async registerWebhooks(context, endpointBaseUrl) {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) throw new Error("META_WEBHOOK_VERIFY_TOKEN is required to activate Meta Lead Ads webhooks.");
    await graph(context.credentials, `${context.credentials.clientId}/subscriptions?${new URLSearchParams({ object: "page", callback_url: endpointBaseUrl, fields: "leadgen", verify_token: verifyToken })}`, `${context.credentials.clientId}|${context.credentials.clientSecret}`, { method: "POST" });
    await graph(context.credentials, `${context.credentials.pageId}/subscribed_apps?subscribed_fields=leadgen`, context.credentials.pageAccessToken, { method: "POST" });
    return [{ eventType: "leadgen", endpointUrl: endpointBaseUrl, externalRegistrationId: context.credentials.pageId }];
  },
};

export async function retrieveMetaLead(credentials: MetaCredentials, leadId: string) { return await (await graph(credentials, `${encodeURIComponent(leadId)}?fields=id,created_time,field_data,form_id,ad_id,adset_id,campaign_id`)).json() as Record<string, unknown>; }
