import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeCrmGatewayAction, prepareCrmGatewayChange } from "../lib/crm/gateway-service.ts";
import type { ActionJobRecord } from "../lib/jobs/record.ts";
const ids={partnerId:"11111111-1111-4111-8111-111111111111",clientId:"22222222-2222-4222-8222-222222222222",actorId:"33333333-3333-4333-8333-333333333333",connectionId:"44444444-4444-4444-8444-444444444444",key:"55555555-5555-4555-8555-555555555555"};
const command={action:"prepare_hubspot_change",key:ids.key,connectionId:ids.connectionId,expectedRevision:"revision",operation:"contact.create",properties:{firstname:"Sam"},targetConfirmed:true,newIdentityConfirmed:true};
function replayAdmin(prior:unknown){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:prior,error:null})};return {from:()=>q} as unknown as SupabaseClient;}
test("a durably attempted HubSpot command returns uncertain before any token read or provider effect",async()=>{
 let calls=0;const admin={rpc:async(name:string)=>{calls++;assert.equal(name,"crm_gateway_action_check");return {data:{allowed:false,uncertain:true,reason:"Reconcile exact created object"},error:null};},from:()=>{throw new Error("No token or mutable source read is permitted after an unknown create.");}} as unknown as SupabaseClient;
 const outcome=await executeCrmGatewayAction(admin,{id:ids.key,partner_id:ids.partnerId,client_id:ids.clientId,kind:"crm.sync",payload:{crm_gateway_version:1}} as unknown as ActionJobRecord);
 assert.equal(outcome.status,"uncertain");assert.equal(outcome.attempted,false);assert.equal(calls,1);
});
test("owner preparation repeats the saved command receipt without rereading a changed source",async()=>{
 const result={id:ids.key,approvalId:ids.key,connectionId:ids.connectionId,message:"Saved",replayed:false};
 const prior={actor_id:ids.actorId,command:{owner_request:{...command,properties:{firstname:"Sam"}}},result};
 const response=await prepareCrmGatewayChange(replayAdmin(prior),ids,command);assert.equal(response.replayed,true);assert.equal(response.approvalId,ids.key);
 await assert.rejects(prepareCrmGatewayChange(replayAdmin(prior),ids,{...command,properties:{firstname:"Other"}}),/different review/);
 await assert.rejects(prepareCrmGatewayChange(replayAdmin(prior),{...ids,actorId:ids.clientId},command),/different review/);
});
test("unsupported CRM updates, inferred targets and oversized notes never reach storage",async()=>{
 const admin={from:()=>{throw new Error("Invalid commands cannot reach storage.");}} as unknown as SupabaseClient;
 for(const input of [{...command,operation:"contact.update"},{...command,newIdentityConfirmed:undefined},{...command,recordId:ids.key},{...command,operation:"note.create",properties:undefined,newIdentityConfirmed:undefined,recordId:ids.key,expectedSourceRevision:"source",note:"a".repeat(4001)}])await assert.rejects(prepareCrmGatewayChange(admin,ids,input),/Review the current exact/);
});
