import test from "node:test";
import assert from "node:assert/strict";
import { inferIndustry, recommendRecipes } from "../lib/business/catalog.ts";
import { EMPTY_PROFILE, type BusinessRecord } from "../lib/business/types.ts";
import { allowedTransitions, opportunityEconomics, RECORD_SCHEMA, reorderQuantity } from "../lib/business/rules.ts";
import { canReadBusinessWorkspace, canWriteBusinessWorkspace } from "../lib/business/access.ts";
import { buildAccessContext } from "../lib/permissions/roles.ts";
import { clientHomePath } from "../lib/permissions/client-sections.ts";
const record=(override:Partial<BusinessRecord>):BusinessRecord=>({id:"00000000-0000-4000-8000-000000000099",kind:"product",title:"Test item",body:"",data:{sku:"",quantity:2,reorder_point:3,target_stock:10,unit_cost:5,price:12,supplier:""},status:"draft",revision:1,source_record_id:null,created_at:"2026-10-03T00:00:00Z",updated_at:"2026-10-03T00:00:00Z",...override});
test("business description suggests relevant operating patterns and goals",()=>{
 assert.equal(inferIndustry("I resell golf equipment"),"retail");assert.equal(inferIndustry("A personal trainer"),"trainer");assert.equal(inferIndustry("Hair salon"),"salon");
 const recommended=recommendRecipes({...EMPTY_PROFILE,industry:"retail",goals:["Find products & suppliers"]});
 assert.equal(recommended[0].recipe.key,"sourcing-analyst");
 assert.equal(recommendRecipes({...EMPTY_PROFILE,industry:"salon",goals:["Improve marketing"]})[0].recipe.key,"marketing-studio");
});
test("sourcing economics include shipping and fees and handle zero resale",()=>{
 assert.deepEqual(opportunityEconomics({cost:100,shipping:20,fees:10,resale:200}),{landed:130,profit:70,margin:35});
 assert.equal(opportunityEconomics({cost:100,resale:0}).margin,null);
 assert.equal(opportunityEconomics({cost:120,resale:100}).profit,-20);
 assert.throws(()=>opportunityEconomics({cost:-1,resale:100}));
});
test("purchase planner accounts for every outstanding request without counting received orders",()=>{
 const product=record({});const purchase=(quantity:number,status:BusinessRecord["status"])=>record({kind:"purchase",status,data:{product_id:product.id,quantity}});
 assert.equal(reorderQuantity(product,[]),8);
 assert.equal(reorderQuantity(product,[purchase(3,"draft"),purchase(2,"ordered"),purchase(6,"received")]),3);
 assert.equal(reorderQuantity(product,[purchase(100,"needs_approval")]),0);
 assert.equal(reorderQuantity(record({data:{...product.data,quantity:5}}),[]),0);
});
test("external effects cannot be completed by approving a record",()=>{
 assert.equal(allowedTransitions("purchase","draft").some(t=>t.action==="order"),false);
 assert.equal(allowedTransitions("purchase","needs_approval").find(t=>t.action==="approve")?.next,"approved");
 assert.equal(allowedTransitions("purchase","approved").some(t=>t.action==="receive"),false);
 assert.equal(allowedTransitions("purchase","ordered").find(t=>t.action==="receive")?.next,"received");
 assert.equal(allowedTransitions("purchase","received").some(t=>t.action==="receive"),false);
 assert.equal(allowedTransitions("campaign","approved").find(t=>t.action==="publish")?.next,"published");
 assert.deepEqual(allowedTransitions("job","archived"),[]);
});
test("records reject unsafe URLs, invalid dates, fractional stock and missing purchase quantities",()=>{
 assert.equal(RECORD_SCHEMA.safeParse({kind:"opportunity",title:"Bad source",data:{url:"javascript:alert(1)",cost:2,resale:5}}).success,false);
 assert.equal(RECORD_SCHEMA.safeParse({kind:"job",title:"Date test",data:{due_date:"2026-99-45"}}).success,false);
 assert.equal(RECORD_SCHEMA.safeParse({...record({}),data:{...record({}).data,quantity:1.5}}).success,false);
 assert.equal(RECORD_SCHEMA.safeParse({kind:"purchase",title:"No quantity",data:{quantity:0,unit_cost:1}}).success,false);
});
test("full business access is denied to staff and managers with restricted sections",()=>{
 const owner=buildAccessContext({userId:"owner",role:"client_owner",clientId:"client",partnerId:"partner",clientPortalEnabled:true});
 assert.equal(canReadBusinessWorkspace(owner),true);assert.equal(canWriteBusinessWorkspace(owner),true);
 const staff=buildAccessContext({userId:"staff",role:"client_staff",clientId:"client",partnerId:"partner",clientPortalEnabled:true});
 assert.equal(canReadBusinessWorkspace(staff),false);
 const manager=buildAccessContext({userId:"manager",role:"client_manager",clientId:"client",partnerId:"partner",clientPortalEnabled:true,clientPermissions:{sections:["tasks"],view_action_center:true}});
 assert.equal(canReadBusinessWorkspace(manager),false);
 assert.equal(canWriteBusinessWorkspace({...owner,isImpersonating:true,impersonationMode:"read_only"}),false);
 assert.equal(canWriteBusinessWorkspace({...owner,isImpersonating:true,impersonationMode:"sandbox_full"}),true);
});
test("owner navigation opens the business app while limited users keep their permitted landing",()=>{
 assert.equal(clientHomePath(["overview","action-center"],"northstar_crm"),"/client");
 assert.equal(clientHomePath(["contacts"],"northstar_crm"),"/client/crm?view=contacts");
});
