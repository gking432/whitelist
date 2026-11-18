import assert from "node:assert/strict";
import test from "node:test";
import { mapConnectedData } from "../lib/connections/record-mapper.ts";
import type { ConnectedApp } from "../lib/connections/types.ts";
import type { ImportedRow } from "../lib/connections/records.ts";
const apps:ConnectedApp[]=["810001","810002"].map((portal,i)=>({id:`connection-${i}`,name:"HubSpot",account:`Portal ${portal}`,provider:"hubspot",status:"connected",paused:false,readOnly:true,sourceAccountId:portal,lastSyncedAt:null,syncing:false,error:null}));
const row=(connection=0,type="customer",extra:Record<string,unknown>={}):ImportedRow=>({id:`source-${connection}-${type}`,connection_id:apps[connection].id,object_type:type,external_object_id:"100",external_parent_id:null,external_updated_at:"2026-11-17T12:00:00Z",updated_at:"2026-11-17T12:01:00Z",snapshot_observed_at:"2026-11-17T12:01:00Z",native_object_id:null,canonical_data:{portal_id:apps[connection].sourceAccountId,first_name:"Sam",email:"same@example.com",archived:false,...extra}});
test("same contact ID and email in two portals retain exact separate external source identities",()=>{
 const data=mapConnectedData(apps,[row(),row(1)]);assert.equal(data.customers?.length,2);assert.notEqual(data.customers?.[0].connectionId,data.customers?.[1].connectionId);assert.equal(data.leads?.length,0);
 assert.equal(data.customers?.[0].href,"https://app.hubspot.com/contacts/810001/contact/100");
 assert.equal(mapConnectedData(apps,[row(0,"customer",{portal_id:"810002"})]).customers?.length,0);
});
test("archived contacts remain explicit source evidence and deals are not intake leads or money",()=>{
 const data=mapConnectedData(apps,[row(0,"customer",{deleted:true,archived:true}),row(0,"lead",{title:"Source deal",amount:"123.45",currency:"USD",associated_contact_ids:["100"],associations_partial:true})]);
 assert.equal(data.customers?.[0].archived,true);assert.equal(data.crmDeals?.[0].associationsPartial,true);assert.equal(data.crmDeals?.[0].amount,"123.45");assert.equal(data.leads?.length,0);assert.equal(data.invoices?.length,0);
});
