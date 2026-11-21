import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

type Flow = "readonly_google" | "readonly_microsoft" | "google_upgrade" | "hubspot" | "hubspot_begin";
type Scenario = {
  flow: Flow; rpcError?: "PT409" | "40001" | "08006"; rpcThrows?: boolean; commitThenError?: boolean;
  replay?: boolean; signedOut?: boolean; viewOnlyActor?: boolean; impersonating?: boolean; missingCookie?: boolean;
  denied?: boolean; missingCode?: boolean; wrongProvider?: boolean; wrongAccount?: boolean; missingScope?: boolean;
  staleSource?: boolean; consumeError?: boolean; cleanupError?: boolean; enqueueError?: boolean;
  reconnect?: boolean; selected?: string[]; requestPermissions?: string[]; tamperedState?: boolean;
};
type Observation = {
  outcomes: string[]; thrown: boolean; cookieCleared: boolean[]; grantCommits: number;
  order: string[];
  effects: { enqueue: number; scheduled: number; processed: number; retired: number; encrypted: number };
  transport: { host: string; path: string; method: string; grant: string | null }[];
  rpc: { name: string; keys: string[]; scoped: boolean; exactAttempt: boolean; exactAccount: boolean; permissions?: string[] }[];
  consumption: { scope: boolean; actor: boolean; connection: boolean; provider: boolean; cookie: boolean; unused: boolean; expiry: boolean }[];
  begin?: { accountPinned: boolean; selected: string[]; stateBound: boolean; cookieBound: boolean; secretsInUrl: boolean };
};

/** Run the actual callbacks, protocol guards and provider verification code.
 * Only external Auth/SDK/secret storage and provider HTTP are injected. The
 * provider fixture never forwards a request and is not live OAuth evidence. */
function caller(scenario: Scenario): Observation {
  const program = `
    const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),ts=require('typescript');
    const scenario=${JSON.stringify(scenario)},root=process.cwd(),cache=new Map();
    const ids={partner:'11111111-1111-4111-8111-111111111111',client:'22222222-2222-4222-8222-222222222222',actor:'33333333-3333-4333-8333-333333333333',connection:'44444444-4444-4444-8444-444444444444',attempt:'55555555-5555-4555-8555-555555555555'};
    const hubspot=scenario.flow.startsWith('hubspot'),upgrade=scenario.flow==='google_upgrade',provider=hubspot?'hubspot':scenario.flow==='readonly_microsoft'?'microsoft_365':'google_workspace';
    const out={outcomes:[],thrown:false,cookieCleared:[],grantCommits:0,order:[],effects:{enqueue:0,scheduled:0,processed:0,retired:0,encrypted:0},transport:[],rpc:[],consumption:[]};
    const cookie='browser-fixture',digest=v=>require('node:crypto').createHash('sha256').update(v).digest('hex');
    const at=new Date().toISOString(),account=hubspot?'12345':'immutable-account-fixture',selected=scenario.selected||[],requested=scenario.requestPermissions||(upgrade?['calendar.write']:selected);
    let consumed=false,retired=false;
    const client={clientId:'client-fixture',clientSecret:'secret-fixture',redirectUri:'https://app.synthetic.invalid/api/oauth/hubspot/callback'};
    const config={workspace_view_only:true,hubspot_owner_crm:hubspot,hubspot_selected_permissions:selected};
    const portal={kind:'ok',client:{id:ids.client,partner_id:ids.partner},access:{isImpersonating:!!scenario.impersonating}};
    const cipher=v=>'fixture-encrypted:'+v,plain=v=>v.startsWith('fixture-encrypted:')?v.slice(18):v;
    const verifier=hubspot?cipher(JSON.stringify({clientId:client.clientId,redirectUri:client.redirectUri,nonce:'nonce-fixture'})):cipher('pkce-fixture');
    const attempt={id:ids.attempt,partner_id:ids.partner,client_id:ids.client,actor_id:ids.actor,connection_id:ids.connection,provider_key:provider,purpose:hubspot?'hubspot_oauth':upgrade?'permission_upgrade':'read_only',cookie_hash:digest(cookie),encrypted_verifier:verifier,expected_account_id:account,expected_connection_updated_at:at,expected_secret_updated_at:at,requested_permissions:requested,expires_at:new Date(Date.now()+600000).toISOString()};
    const backendError={code:scenario.rpcError||'08006',message:'secret-fixture browser-fixture access-fixture code-fixture',details:'must not expose'};
    function from(table){let operation='select',columns='',values,filters=[],executed;
      const b={select(v){columns=v;return b;},update(v){operation='update';values=v;return b;},delete(){operation='delete';return b;},eq(...v){filters.push(['eq',...v]);return b;},is(...v){filters.push(['is',...v]);return b;},not(...v){filters.push(['not',...v]);return b;},gt(...v){filters.push(['gt',...v]);return b;},maybeSingle(){return execute();},single(){return execute();},throwOnError(){return execute().then(r=>{if(r.error)throw r.error;return r;});},then(a,z){return execute().then(a,z);}};
      const equals=(key,value)=>filters.some(f=>f[0]==='eq'&&f[1]===key&&f[2]===value);
      function execute(){return executed??=(async()=>{
        if(table==='business_connection_oauth_attempts'&&operation==='delete'){out.effects.retired++;retired=true;return{data:null,error:scenario.cleanupError?backendError:null};}
        if(table==='business_connection_oauth_attempts'&&operation==='update'){
          const binding={scope:equals('partner_id',ids.partner)&&equals('client_id',ids.client),actor:equals('actor_id',ids.actor),connection:equals('connection_id',ids.connection),provider:equals('provider_key',provider),cookie:equals('cookie_hash',digest(cookie)),unused:filters.some(f=>f[0]==='is'&&f[1]==='consumed_at'&&f[2]===null),expiry:filters.some(f=>f[0]==='gt'&&f[1]==='expires_at')};out.consumption.push(binding);
          if(scenario.consumeError)return{data:null,error:backendError};
          if(consumed||retired||Object.values(binding).some(v=>!v)||!equals('id',ids.attempt))return{data:null,error:null};
          consumed=true;return{data:{...attempt,...values},error:null};
        }
        if(table==='integration_connections')return{data:{id:ids.connection,partner_id:ids.partner,client_id:ids.client,config,status:'connected',credential_status:'configured',external_account_id:account,external_account_name:'owner@synthetic.invalid',updated_at:scenario.staleSource?'changed-revision':at,provider:{provider_key:scenario.wrongProvider?'stripe':provider}},error:null};
        if(table==='integration_secrets')return{data:{updated_at:at,encrypted_value:cipher(JSON.stringify({...client,accountId:account,refreshToken:'refresh-fixture'}))},error:null};
        throw new Error('Unexpected fixture query');
      })();}return b;
    }
    const admin={from,async rpc(name,args){out.order.push(name);out.rpc.push({name,keys:Object.keys(args).sort(),scoped:args.p_partner===ids.partner&&args.p_client===ids.client&&args.p_actor===ids.actor,exactAttempt:args.p_attempt===ids.attempt,exactAccount:args.p_account_id===account,...(args.p_permissions||args.p_selected_permissions?{permissions:args.p_permissions||args.p_selected_permissions}:{})});
      if(scenario.commitThenError)out.grantCommits++;
      if(scenario.rpcThrows)throw backendError;
      if(scenario.rpcError||scenario.commitThenError)return{data:null,error:backendError,status:scenario.rpcError==='PT409'?409:503};
      if(name==='begin_hubspot_oauth')return{data:{attemptId:ids.attempt,connectionId:ids.connection,expectedAccountId:scenario.reconnect?account:null},error:null};
      out.grantCommits++;out.order.push('grant_committed');return{data:null,error:null};
    }};
    const actualNext=require('next/server');
    const env={getAppUrl:()=> 'https://app.synthetic.invalid',getSecretsEncryptionKey:()=> 'state-secret-fixture',getGoogleOAuthClient:()=>client,getMicrosoftOAuthClient:()=>client};
    const mocks=new Map([
      ['lib/env.ts',env],['lib/auth/session.ts',{getAuthState:async()=>({user:scenario.signedOut?null:{id:ids.actor}})}],['lib/clients/portal.ts',{loadClientPortal:async()=>portal}],['lib/business/access.ts',{canWriteBusinessWorkspace:()=>!scenario.viewOnlyActor}],['lib/supabase/admin.ts',{createSupabaseAdminClient:()=>admin}],
      ['lib/integrations/secrets.ts',{encryptSecret:cipher,decryptSecret:plain}],['lib/integrations/credentials.ts',{encryptProviderCredentials:v=>{out.effects.encrypted++;return{encrypted_value:cipher(JSON.stringify(v)),last_four:'ture'};}}],
      ['lib/integrations/connectors/sync-runner.ts',{enqueueInitialConnectorSync:async(_a,input)=>{if(input.partnerId!==ids.partner||input.clientId!==ids.client||input.connectionId!==ids.connection||input.providerKey!==provider)throw new Error('Wrong scoped import');out.order.push('enqueue');out.effects.enqueue++;if(scenario.enqueueError)throw backendError;},processConnectorSyncJobs:async(limit,input)=>{if(limit!==4||input.connectionId!==ids.connection||input.readOnly!==true)throw new Error('Unexpected worker');out.order.push('process');out.effects.processed++;}}],
    ]);
    function load(file){file=path.resolve(file);const relative=path.relative(root,file);if(mocks.has(relative))return mocks.get(relative);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
      const compiled=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
      const localRequire=name=>{if(name==='next/server')return{...actualNext,after:fn=>{out.order.push('after');out.effects.scheduled++;queued.push(fn);}};if(name.startsWith('node:'))return require(name);let resolved=name.startsWith('@/')?path.resolve(root,name.slice(2)):name.startsWith('.')?path.resolve(path.dirname(file),name):null;if(!resolved)return require(name);if(!path.extname(resolved))resolved+='.ts';return load(resolved);};
      new Function('require','exports',compiled)(localRequire,exports);return exports;
    }
    const queued=[],workspace=load('lib/integrations/providers/workspace-oauth.ts'),hubProvider=load('lib/integrations/providers/hubspot-oauth.ts');
    process.env.HUBSPOT_CLIENT_ID=client.clientId;process.env.HUBSPOT_CLIENT_SECRET=client.clientSecret;
    const rights=hubspot?hubProvider.hubspotOAuthScopes(requested):upgrade?[...workspace.GOOGLE_WORKSPACE_READ_SCOPES,'https://www.googleapis.com/auth/calendar.events','https://www.googleapis.com/auth/calendar.calendarlist.readonly']:[...workspace.workspaceReadScopes(provider)];
    const granted=scenario.missingScope?rights.filter(s=>!s.includes('contacts.write')&&!s.includes('calendar.events')&&!s.includes('calendarlist')&&!s.includes('Mail.Read')):rights;
    globalThis.fetch=async(url,init={})=>{const u=new URL(String(url)),fields=new URLSearchParams(String(init.body||''));out.transport.push({host:u.host,path:u.pathname,method:init.method||'GET',grant:fields.get('grant_type')});
      if(u.host==='api.hubapi.com'&&u.pathname.endsWith('/introspect')){const use=fields.get('token_type_hint');return Response.json({active:true,token:fields.get(use),token_type:'Bearer',token_use:use,client_id:client.clientId,hub_id:scenario.wrongAccount?54321:12345,user_id:77,app_id:88,hub_domain:'fixture.synthetic.invalid',scopes:granted,...(use==='access_token'?{expires_in:1800}:{})});}
      if(u.host==='api.hubapi.com'&&u.pathname==='/oauth/2026-03/token')return Response.json({token_type:'bearer',access_token:'access-fixture',refresh_token:'refresh-fixture',hub_id:12345,scopes:granted,expires_in:1800});
      if((u.host==='oauth2.googleapis.com'&&u.pathname==='/token')||(u.host==='login.microsoftonline.com'&&u.pathname.endsWith('/token')))return Response.json({access_token:'access-fixture',...(fields.get('grant_type')==='authorization_code'?{refresh_token:'refresh-fixture'}:{}),scope:granted.join(' ')});
      if(u.host==='oauth2.googleapis.com'&&u.pathname==='/tokeninfo')return Response.json({aud:client.clientId,sub:scenario.wrongAccount?'wrong-account':account,scope:granted.join(' ')});
      if(u.host==='www.googleapis.com'&&u.pathname==='/oauth2/v2/userinfo'||u.host==='graph.microsoft.com'&&u.pathname==='/v1.0/me')return Response.json({id:scenario.wrongAccount?'wrong-account':account,email:'owner@synthetic.invalid',mail:'owner@synthetic.invalid'});
      if((u.host==='gmail.googleapis.com'&&u.pathname==='/gmail/v1/users/me/profile')||(u.host==='www.googleapis.com'&&u.pathname==='/calendar/v3/calendars/primary/events')||(u.host==='graph.microsoft.com'&&['/v1.0/me/mailFolders/inbox/messages','/v1.0/me/calendar/events'].includes(u.pathname)))return Response.json({items:[]});
      throw new Error('Blocked unexpected provider fixture request');
    };
    (async()=>{const module=load(hubspot?'lib/connections/hubspot-oauth.ts':'lib/connections/oauth.ts');
      if(scenario.flow==='hubspot_begin'){
        try{const result=await module.startHubSpotOAuth(admin,{partnerId:ids.partner,clientId:ids.client},ids.actor,scenario.reconnect?ids.connection:undefined,scenario.requestPermissions||[]);const u=new URL(result.url),s=module.readHubSpotOAuthState(u.searchParams.get('state'));out.begin={accountPinned:u.pathname==='/oauth/'+account+'/authorize',selected:(u.searchParams.get('scope')||'').split(' ').sort(),stateBound:s?.attemptId===ids.attempt&&s?.connectionId===ids.connection,cookieBound:result.cookieName==='hubspot_oauth_'+ids.attempt&&!!result.cookie,secretsInUrl:u.href.includes(client.clientSecret)||u.href.includes(result.cookie)};}catch{out.thrown=true;}
      }else{
        const state=hubspot?{provider:'hubspot',attemptId:ids.attempt,connectionId:ids.connection}:{providerKey:provider,connectionId:ids.connection,setupSessionId:null,...(upgrade?{permissionAttemptId:ids.attempt}:{readOnlyAttemptId:ids.attempt})};
        const u=new URL('https://app.synthetic.invalid/api/oauth/'+provider+'/callback');if(!scenario.missingCode)u.searchParams.set('code','code-fixture');if(scenario.denied)u.searchParams.set('error','access_denied');if(hubspot){const signed=module.signHubSpotOAuthState(state);u.searchParams.set('state',scenario.tamperedState?signed+'.tampered':signed);}
        const cookieName=(hubspot?'hubspot_oauth_':upgrade?'workspace_permissions_':'workspace_read_')+ids.attempt;
        const request=new actualNext.NextRequest(u,{headers:scenario.missingCookie?{}:{cookie:cookieName+'='+cookie}});
        const invoke=()=>hubspot?module.completeHubSpotOAuth(request):upgrade?module.completeGooglePermissionUpgrade(request,state):module.completeReadOnlyOAuth(request,state);
        for(let i=0;i<(scenario.replay?2:1);i++){try{const response=await invoke();out.outcomes.push(new URL(response.headers.get('location')).searchParams.get('connection'));out.cookieCleared.push(/1970|Max-Age=0/.test(response.headers.get('set-cookie')||''));}catch{out.thrown=true;}}
        for(const work of queued)await work();
      }
      process.stdout.write(JSON.stringify(out));
    })().catch(()=>{process.stderr.write('OAuth fixture failed');process.exitCode=1;});
  `;
  return JSON.parse(execFileSync(process.execPath, ["--eval", program], { encoding: "utf8", timeout: 15000, maxBuffer: 100000 })) as Observation;
}

const completedFlows: Flow[] = ["readonly_google", "readonly_microsoft", "google_upgrade", "hubspot"];
const finishRpc = (flow: Flow) => flow === "hubspot" ? "finish_hubspot_oauth" : flow === "google_upgrade" ? "finish_google_permission_upgrade" : "finish_readonly_workspace_oauth";
const successful = (flow: Flow) => flow === "google_upgrade" ? "permissions_updated" : "connected";
const failed = (flow: Flow) => flow === "hubspot" ? "failed" : flow === "google_upgrade" ? "permissions_changed" : "changed";
const exchanges = (result: Observation) => result.transport.filter((call) => call.grant === "authorization_code").length;
const verifiedRequests = (flow: Flow) => flow === "hubspot" ? 3 : 5;
function noImport(result: Observation) { assert.equal(result.effects.enqueue, 0); assert.equal(result.effects.scheduled, 0); assert.equal(result.effects.processed, 0); }

test("all real OAuth finish callers stop on PT409, legacy semantic conflicts and unavailable replies without re-exchange or import scheduling", () => {
  for (const flow of completedFlows) for (const rpcError of ["PT409", "40001", "08006"] as const) {
    const result = caller({ flow, rpcError, replay: true });
    assert.equal(result.thrown, false); assert.deepEqual(result.outcomes, [failed(flow), "expired"]); assert.deepEqual(result.cookieCleared, [true, true]);
    assert.equal(exchanges(result), 1); assert.equal(result.rpc.length, 1); assert.equal(result.rpc[0].name, finishRpc(flow)); assert.equal(result.rpc[0].exactAttempt, true);
    assert.equal(result.transport.length, verifiedRequests(flow), "Conflict and replay must not repeat even a verification or refresh request.");
    assert.equal(result.rpc[0].exactAccount, true); assert.equal(result.grantCommits, 0); noImport(result);
    assert.ok(result.consumption.every((binding) => Object.values(binding).every(Boolean)));
  }
});

test("a rejected finish transport and a genuinely unknown committed response never trigger an automatic second exchange or import", () => {
  for (const flow of completedFlows) {
    const unavailable = caller({ flow, rpcThrows: true, replay: true });
    assert.equal(unavailable.thrown, false); assert.equal(unavailable.outcomes[0], flow === "google_upgrade" ? "permissions_failed" : "failed"); assert.equal(unavailable.outcomes[1], "expired");
    assert.equal(exchanges(unavailable), 1); assert.equal(unavailable.rpc.length, 1); noImport(unavailable);
    const unknown = caller({ flow, commitThenError: true, replay: true });
    assert.deepEqual(unknown.outcomes, [failed(flow), "expired"]); assert.equal(unknown.grantCommits, 1, "An unknown response must not be described as proof that the old grant remained.");
    assert.equal(exchanges(unknown), 1); assert.equal(unknown.rpc.length, 1); noImport(unknown);
    assert.equal(unknown.transport.length, verifiedRequests(flow)); assert.equal(unavailable.transport.length, verifiedRequests(flow));
  }
});

test("successful provider-transport fixtures commit once before any read-only import, and single-use replay never re-exchanges", () => {
  for (const flow of completedFlows) {
    const result = caller({ flow, replay: true }); assert.equal(result.thrown, false); assert.deepEqual(result.outcomes, [successful(flow), "expired"]);
    assert.equal(exchanges(result), 1); assert.equal(result.rpc.length, 1); assert.equal(result.grantCommits, 1);
    assert.equal(result.transport.length, verifiedRequests(flow));
    if (flow === "google_upgrade") { noImport(result); assert.deepEqual(result.rpc[0].permissions, ["calendar.write"]); assert.deepEqual(result.order, [finishRpc(flow), "grant_committed"]); }
    else { assert.deepEqual([result.effects.enqueue, result.effects.scheduled, result.effects.processed], [1, 1, 1]); assert.deepEqual(result.order, [finishRpc(flow), "grant_committed", "enqueue", "after", "process"]); }
    assert.ok(result.transport.every((call) => ["GET", "POST"].includes(call.method)));
  }
});

test("the HubSpot begin caller preserves server actor/scope, exact reconnect and additive selected permissions and never retries a failed attempt", () => {
  for (const rpcError of ["PT409", "40001", "08006"] as const) {
    const result = caller({ flow: "hubspot_begin", reconnect: true, selected: ["contact.create"], requestPermissions: ["note.create"], rpcError });
    assert.equal(result.thrown, true); assert.equal(result.rpc.length, 1); assert.equal(result.rpc[0].name, "begin_hubspot_oauth"); assert.equal(result.rpc[0].scoped, true);
    assert.deepEqual(result.rpc[0].permissions, ["contact.create", "note.create"]); assert.equal(result.transport.length, 0); noImport(result); assert.equal(result.begin, undefined);
  }
  const reconnect = caller({ flow: "hubspot_begin", reconnect: true, selected: ["contact.create"], requestPermissions: ["note.create"] });
  assert.equal(reconnect.thrown, false); assert.deepEqual(reconnect.begin, { accountPinned: true, selected: ["crm.objects.contacts.read", "crm.objects.contacts.write", "crm.objects.deals.read", "oauth"], stateBound: true, cookieBound: true, secretsInUrl: false });
  const separate = caller({ flow: "hubspot_begin" }); assert.equal(separate.begin?.accountPinned, false); assert.equal(separate.begin?.stateBound, true);
  const premature = caller({ flow: "hubspot_begin", requestPermissions: ["note.create"] }); assert.equal(premature.thrown, true); assert.equal(premature.rpc.length, 0);
});

test("fresh owner permissions, browser cookie, denial and consumed attempt boundaries stop before provider exchange and grant persistence", () => {
  for (const flow of completedFlows) for (const boundary of ["signedOut", "viewOnlyActor", "impersonating", "missingCookie", "denied", "missingCode", "consumeError"] as const) {
    const result = caller({ flow, [boundary]: true }); assert.equal(exchanges(result), 0); assert.equal(result.rpc.length, 0); assert.equal(result.grantCommits, 0); noImport(result);
    assert.equal(result.thrown, false); assert.notEqual(result.outcomes[0], successful(flow));
  }
  const tampered = caller({ flow: "hubspot", tamperedState: true }); assert.deepEqual(tampered.outcomes, ["expired"]); assert.equal(tampered.consumption.length, 0); assert.equal(tampered.transport.length, 0);
});

test("actual Google and HubSpot account/grant verification still rejects a different account or missing selected scopes before finish", () => {
  for (const flow of ["google_upgrade", "hubspot"] as const) for (const boundary of ["wrongAccount", "missingScope"] as const) {
    const result = caller({ flow, selected: flow === "hubspot" ? ["note.create"] : undefined, [boundary]: true });
    assert.equal(exchanges(result), 1); assert.equal(result.rpc.length, 0); assert.equal(result.grantCommits, 0); noImport(result);
    assert.equal(result.thrown, false); assert.notEqual(result.outcomes[0], successful(flow));
  }
  const stale = caller({ flow: "google_upgrade", staleSource: true }); assert.deepEqual(stale.outcomes, ["permissions_changed"]); assert.equal(stale.transport.length, 0); assert.equal(stale.rpc.length, 0);
});

test("a committed read-only connection whose initial sync enqueue fails reports pending without reauthorizing or scheduling a worker", () => {
  for (const flow of ["readonly_google", "readonly_microsoft", "hubspot"] as const) {
    const result = caller({ flow, enqueueError: true, replay: true }); assert.deepEqual(result.outcomes, ["sync_pending", "expired"]);
    assert.equal(result.grantCommits, 1); assert.equal(exchanges(result), 1); assert.equal(result.rpc.length, 1); assert.equal(result.effects.enqueue, 1); assert.equal(result.effects.scheduled, 0); assert.equal(result.effects.processed, 0);
  }
});
