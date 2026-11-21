import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActionJobRecord } from "../jobs/record.ts";
import type { DeliveryOutcome } from "../delivery/customer-message.ts";
import { ActionSuppressedError } from "../jobs/action-preflight.ts";
import { loadHubSpotOAuthCredentials } from "../connections/hubspot-oauth.ts";
import { mapConnectedData } from "../connections/record-mapper.ts";
import { hubSpotSourceFingerprint } from "../integrations/providers/hubspot.ts";
import { executeHubSpotGatewayWrite, hubSpotGatewayPinBlock } from "./provider-gateway.ts";
import type { CrmGatewayPin, CrmGatewayReview, CrmGatewayDecisionReceipt, CrmGatewayReceipt, HubSpotOwnerPermission } from "./provider-contract.ts";

type Scope = { partnerId: string; clientId: string };
export class CrmGatewayError extends Error { readonly status: number; constructor(message: string, status = 409) { super(message); this.status = status; } }
const Query = z.object({ connectionId: z.uuid(), recordId: z.uuid().optional(), sourceRunId: z.uuid().optional() }).strict();
const Properties = z.object({ firstname: z.string().trim().min(1).max(100).optional(), lastname: z.string().trim().min(1).max(100).optional(), email: z.email().max(254).optional(), phone: z.string().trim().min(1).max(50).optional(), address: z.string().trim().min(1).max(500).optional() }).strict();
const Command = z.object({ action: z.literal("prepare_hubspot_change"), key: z.uuid(), connectionId: z.uuid(), expectedRevision: z.string().min(1).max(100), operation: z.enum(["contact.create", "note.create"]), recordId: z.uuid().optional(), expectedSourceRevision: z.string().min(1).max(100).optional(), properties: Properties.optional(), note: z.string().trim().min(1).max(4000).optional(), targetConfirmed: z.literal(true), newIdentityConfirmed: z.literal(true).optional(), sourceRunId: z.uuid().optional() }).strict().superRefine((c, ctx) => {
  if (c.operation === "contact.create" ? (!c.newIdentityConfirmed || c.recordId || c.expectedSourceRevision || c.note || !c.properties || ![c.properties.firstname,c.properties.lastname,c.properties.email,c.properties.phone].some(Boolean)) : (!c.recordId || !c.expectedSourceRevision || !c.note || c.newIdentityConfirmed || c.properties)) ctx.addIssue({ code: "custom", message: "Review the exact supported contact or note decision." });
  if (JSON.stringify(c).includes("\\u0000")) ctx.addIssue({ code: "custom", message: "Invalid text." });
});
const permissions = (config: Record<string, unknown>): HubSpotOwnerPermission[] => Array.isArray(config.hubspot_selected_permissions) ? config.hubspot_selected_permissions.filter((v): v is HubSpotOwnerPermission => v === "contact.create" || v === "note.create") : [];
async function readSourceRun(admin: SupabaseClient, scope: Scope, sourceRunId: string): Promise<NonNullable<CrmGatewayReview["sourceRun"]>> {
  const runResult = await admin.from("workflow_runs").select("id,summary,created_at,template_id,trigger_event_id")
    .eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("id", sourceRunId).maybeSingle();
  if (runResult.error) throw new CrmGatewayError("The original saved work could not be checked.", 503);
  if (!runResult.data || runResult.data.id !== sourceRunId) throw new CrmGatewayError("The saved work reference is unavailable for this business.", 404);
  const run = runResult.data;
  const [template, event] = await Promise.all([
    admin.from("workflow_templates").select("template_key").eq("id", run.template_id).maybeSingle(),
    run.trigger_event_id ? admin.from("integration_events").select("event_type").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId).eq("id", run.trigger_event_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (template.error || !template.data || event.error || (run.trigger_event_id && !event.data)) throw new CrmGatewayError("The original work's source metadata could not be checked.", 503);
  const bounded = (value: unknown, limit: number) => typeof value === "string" && value.trim() ? value.slice(0, limit) : null;
  return { id: run.id, summary: bounded(run.summary, 2000), eventType: bounded(event.data?.event_type, 160), templateKey: bounded(template.data.template_key, 160), createdAt: bounded(run.created_at, 100) };
}
async function load(admin: SupabaseClient, scope: Scope, input: z.infer<typeof Query>) {
  const sourceRun = input.sourceRunId ? await readSourceRun(admin, scope, input.sourceRunId) : undefined;
  const scoped = (table: string) => admin.from(table).select("*").eq("partner_id", scope.partnerId).eq("client_id", scope.clientId);
  const [accountResult, sourceResult, settingsResult, businessResult] = await Promise.all([
    admin.from("integration_connections").select("id,display_name,external_account_name,external_account_id,status,runtime_mode,credential_status,config,provider:integration_providers!inner(provider_key)").eq("partner_id",scope.partnerId).eq("client_id",scope.clientId).eq("id",input.connectionId).maybeSingle(),
    input.recordId ? scoped("integration_canonical_records").eq("connection_id",input.connectionId).eq("id",input.recordId).eq("object_type","customer").maybeSingle() : Promise.resolve({data:null,error:null}),
    scoped("agent_team_settings").maybeSingle(),
    admin.from("client_businesses").select("customer_system_connection_id").eq("id",scope.clientId).eq("partner_id",scope.partnerId).maybeSingle(),
  ]);
  if ([accountResult,sourceResult,settingsResult,businessResult].some((r)=>r.error)) throw new CrmGatewayError("Current CRM source and settings could not be checked.",503);
  const account=accountResult.data, source=sourceResult.data;
  if (!account || (account.provider as unknown as {provider_key:string})?.provider_key!=="hubspot" || account.config?.hubspot_owner_crm!==true || (input.recordId && !source)) throw new CrmGatewayError("The exact business-owned HubSpot source is unavailable.",404);
  const config=account.config as Record<string,unknown>, rights=permissions(config), selected=businessResult.data?.customer_system_connection_id===account.id;
  const pin: CrmGatewayPin={crm_gateway_version:1,provider:"hubspot",operation:source?"note.create":"contact.create",owner_command_id:randomUUID(),connection_id:account.id,account_id:account.external_account_id||"",grant_revision:String(config.hubspot_grant_revision||""),authority_revision:settingsResult.data?.authority_revision ?? -1,
    source_record_id:source?.id??null,source_updated_at:source?.updated_at??null,source_external_updated_at:source?.external_updated_at??null,external_id:source?.external_object_id??null,
    source_fingerprint:source ? hubSpotSourceFingerprint({objectType:"customer",externalId:source.external_object_id,updatedAt:source.external_updated_at,deleted:source.canonical_data?.archived===true||source.canonical_data?.deleted===true,data:source.canonical_data}) : null,
    properties:source?{}:{firstname:"Review"},note_body:source?"Review":null,new_identity_confirmed:!source,source_run_id:null};
  const verdict=await admin.rpc("crm_gateway_source_check",{p_partner:scope.partnerId,p_client:scope.clientId,p_pin:pin});
  if(verdict.error) throw new CrmGatewayError("CRM source policy could not be checked.",503);
  const existingResult = await admin.rpc("hubspot_open_review", { p_partner: scope.partnerId, p_client: scope.clientId, p_connection: account.id, p_source: source?.id ?? null });
  if (existingResult.error) throw new CrmGatewayError("Current CRM reviews and unknown attempts could not be checked.", 503);
  const existing = existingResult.data as CrmGatewayReview["existing"];
  const apps=[{id:account.id,name:account.display_name,provider:"hubspot",account:account.external_account_name,sourceAccountId:account.external_account_id,status:account.status,paused:account.runtime_mode==="paused",readOnly:true,lastSyncedAt:null,syncing:false,error:null}];
  const contact=source ? mapConnectedData(apps,[source]).customers?.[0]??null : null;
  const review:CrmGatewayReview={version:1,connectionId:account.id,accountId:account.external_account_id||"",account:account.external_account_name||account.display_name,revision:String(config.hubspot_config_revision||""),canWrite:true,selectedCrm:selected,actionsEnabled:config.hubspot_actions_enabled===true,permissions:rights,contact,
    blockReason:verdict.data?.allowed===true?null:String(verdict.data?.reason||"Review current account settings."),existing:existing??null,...(sourceRun ? { sourceRun } : {})};
  return {review,pin};
}
export async function readCrmGatewayReview(admin:SupabaseClient,scope:Scope,canWrite:boolean,raw:unknown):Promise<CrmGatewayReview>{
  const parsed=Query.safeParse(raw);if(!parsed.success) throw new CrmGatewayError("Choose one exact HubSpot account and contact.",400);
  const current=await load(admin,scope,parsed.data);return {...current.review,canWrite};
}
export async function prepareCrmGatewayChange(admin:SupabaseClient,actor:Scope&{actorId:string},raw:unknown):Promise<CrmGatewayDecisionReceipt>{
  const parsed=Command.safeParse(raw);if(!parsed.success) throw new CrmGatewayError("Review the current exact contact and bounded properties before preparing this change.",400);
  const command=parsed.data;
  const prior=await admin.from("business_owner_commands").select("actor_id,command,result").eq("partner_id",actor.partnerId).eq("client_id",actor.clientId).eq("request_key",command.key).maybeSingle();
  if(prior.error) throw new CrmGatewayError("Saved decision could not be checked.",503);
  if(prior.data){if(prior.data.actor_id!==actor.actorId || JSON.stringify(prior.data.command.owner_request)!==JSON.stringify(command)) {
    // JSONB key order is not significant.
    const canonical=(v:unknown):string=>JSON.stringify(v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,x&&typeof x==="object"?JSON.parse(canonical(x)):x])):v);
    if(prior.data.actor_id!==actor.actorId||canonical(prior.data.command.owner_request)!==canonical(command)) throw new CrmGatewayError("This request key already identifies a different review.");
  }return {...prior.data.result,replayed:true} as CrmGatewayDecisionReceipt;}
  const current=await load(admin,actor,{connectionId:command.connectionId,...(command.recordId?{recordId:command.recordId}:{}),...(command.sourceRunId?{sourceRunId:command.sourceRunId}:{})});
  if(current.review.revision!==command.expectedRevision || current.review.blockReason || current.review.existing || (command.operation==="note.create" && current.review.contact?.revision!==command.expectedSourceRevision)) throw new CrmGatewayError(current.review.blockReason||current.review.existing?.detail||"The reviewed source changed; refresh this review.");
  const pin:CrmGatewayPin={...current.pin,operation:command.operation,properties:command.properties??{},note_body:command.note??null,new_identity_confirmed:command.newIdentityConfirmed===true,source_run_id:command.sourceRunId??null};
  const block=hubSpotGatewayPinBlock(pin);if(block) throw new CrmGatewayError(block,400);
  const result=await admin.rpc("prepare_hubspot_change",{p_partner:actor.partnerId,p_client:actor.clientId,p_actor:actor.actorId,p_command:{owner_request:command,pin}});
  if(result.error || !result.data?.approvalId) throw new CrmGatewayError("The source, settings or existing review changed. Refresh before preparing another decision.");
  return result.data as CrmGatewayDecisionReceipt;
}
export async function executeCrmGatewayAction(admin:SupabaseClient,job:ActionJobRecord):Promise<DeliveryOutcome&{crmGatewayReceipt?:CrmGatewayReceipt}>{
  const args={p_partner:job.partner_id,p_client:job.client_id,p_job:job.id,p_claim:(job as ActionJobRecord&{claim_token?:string}).claim_token??null};
  const check=async()=>{const result=await admin.rpc("crm_gateway_action_check",args);if(result.error || !result.data || typeof result.data!=="object" || typeof result.data.allowed!=="boolean") throw new Error("CRM delivery policy unavailable.");return result.data as {allowed:boolean;uncertain?:boolean;reason?:string};};
  const preEffectFailure: DeliveryOutcome={attempted:false,delivered:false,status:"failed",detail:"Current CRM authorization or delivery policy could not be checked. No provider write was attempted."};
  let initial: Awaited<ReturnType<typeof check>>;
  try { initial=await check(); } catch { return preEffectFailure; }
  if(!initial.allowed)return {attempted:false,delivered:false,status:initial.uncertain?"uncertain":"skipped",detail:initial.reason||"CRM command stopped."};
  const invalid=hubSpotGatewayPinBlock(job.payload);if(invalid)return {attempted:false,delivered:false,status:"skipped",detail:invalid};
  const pin=job.payload as unknown as CrmGatewayPin;
  let credentials: Awaited<ReturnType<typeof loadHubSpotOAuthCredentials>>;
  try { credentials=await loadHubSpotOAuthCredentials(admin,{partnerId:job.partner_id,clientId:job.client_id},pin.connection_id); } catch { return preEffectFailure; }
  return executeHubSpotGatewayWrite({credentials,pin,beforeWrite:async()=>{const verdict=await check();if(!verdict.allowed)throw new ActionSuppressedError(verdict.reason||"CRM authority changed.");},markAttempted:async()=>{const result=await admin.rpc("mark_crm_gateway_attempt",args);if(result.error||result.data!==true)throw new ActionSuppressedError("The durable single-attempt marker could not be saved. Reconcile before retrying.");}});
}
