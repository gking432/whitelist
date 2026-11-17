import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('This verification runs only against the local database.');
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const client=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
const unwrap=result=>{if(result.error)throw Error(result.error.message);return result.data;};
const login=unwrap(await client.auth.signInWithPassword({email:'client@northstar.test',password:'local-password-change-me'}));
const membership=unwrap(await admin.from('memberships').select('partner_id,client_id').eq('user_id',login.user.id).eq('role','client_owner').limit(1).single());
const p=membership.partner_id,c=membership.client_id,u=login.user.id;
const prefix=`verify-business:${randomUUID()}`;const ids=[];
const create=async(kind,title,data,key=title,source=null)=>{const id=unwrap(await admin.rpc('create_business_record',{p_partner:p,p_client:c,p_actor:u,p_kind:kind,p_title:title,p_body:'Verification record',p_data:data,p_request:`${prefix}:${key}`,p_source:source}));if(!ids.includes(id))ids.push(id);return id;};
const transition=(id,revision,action,reference='')=>admin.rpc('transition_business_record',{p_partner:p,p_client:c,p_actor:u,p_id:id,p_revision:revision,p_action:action,p_reference:reference});
try{
 const product=await create('product','Verification stock',{quantity:2,reorder_point:3,target_stock:10,unit_cost:5,price:12,supplier:'Verification supplier'});
 const purchase=await create('purchase','Verification purchase',{product_id:product,quantity:8,unit_cost:5,shipping:0,supplier:'Verification supplier'});
 assert.equal(await create('purchase','Verification purchase',{quantity:8,unit_cost:5}),purchase,'creation retry must be idempotent');
 unwrap(await transition(purchase,1,'submit'));
 const race=await Promise.all([transition(purchase,2,'approve'),transition(purchase,2,'approve')]);
 assert.equal(race.filter(r=>!r.error).length,1,'exactly one approval must win');
 assert.ok((await transition(purchase,3,'receive')).error,'receipt before order must fail');
 assert.ok((await transition(purchase,3,'order')).error,'external order requires a reference');
 unwrap(await transition(purchase,3,'order','TEST-ORDER-1'));
 unwrap(await transition(purchase,4,'receive'));
 assert.ok((await transition(purchase,4,'receive')).error,'replayed receipt must fail');
 assert.equal(unwrap(await admin.from('business_records').select('data').eq('id',product).single()).data.quantity,10);
 assert.equal(unwrap(await admin.from('business_workspace_events').select('id').eq('record_id',product).eq('action','stock_received')).length,1);
 const campaign=await create('campaign','Verification campaign',{channel:'Email',audience:'Test',budget:0});
 unwrap(await transition(campaign,1,'submit'));
 assert.ok((await admin.rpc('edit_business_record',{p_partner:p,p_client:c,p_actor:u,p_id:campaign,p_revision:2,p_title:'Changed content',p_body:'Changed after submission',p_data:{}})).error,'submitted content must be immutable');
 const own=unwrap(await client.from('business_records').select('id').eq('id',campaign));assert.equal(own.length,1);
 assert.ok((await client.from('business_records').update({status:'approved'}).eq('id',campaign)).error,'direct authenticated writes must be denied');
 assert.ok((await client.rpc('transition_business_record',{p_partner:p,p_client:c,p_actor:u,p_id:campaign,p_revision:2,p_action:'approve',p_reference:''})).error,'public execution of service RPC must be denied');
 const anonymous=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false}});
 assert.ok((await anonymous.from('business_records').select('id')).error,'anonymous table access must be denied');
 const other=unwrap(await admin.from('client_businesses').select('id,partner_id').neq('id',c).limit(1));
 if(other.length){
  const foreign=unwrap(await admin.rpc('create_business_record',{p_partner:other[0].partner_id,p_client:other[0].id,p_actor:u,p_kind:'job',p_title:'Other tenant verification',p_body:'',p_data:{},p_request:prefix}));ids.push(foreign);
  assert.equal(unwrap(await client.from('business_records').select('id').eq('id',foreign)).length,0,'another tenant record must not be visible');
  assert.ok((await transition(foreign,1,'archive')).error,'scoped mutation must reject another tenant');
  assert.ok((await admin.rpc('create_business_record',{p_partner:p,p_client:c,p_actor:u,p_kind:'job',p_title:'Invalid foreign source',p_body:'',p_data:{},p_request:prefix+':foreign',p_source:foreign})).error,'cross-tenant source references must fail');
 }
 console.log('PASS: persisted records, idempotency, concurrent approvals, immutable proposals, ordering, exactly-once stock receipt, role grants, and tenant isolation.');
}finally{
 if(ids.length){unwrap(await admin.from('business_workspace_events').delete().in('record_id',ids));unwrap(await admin.from('business_records').delete().in('id',ids));}
 await client.auth.signOut();
}
