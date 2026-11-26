import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function evaluate(source: string): unknown {
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 }));
}
test("shared question screen gives each answer a heading, explicit button semantics and accessible pending/error states", () => {
  const html = evaluate(`const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),{QuestionScreen}=require('./components/onboarding/question-screen.tsx');const props={question:'What does your business do?',step:2,total:3,onBack(){},onSkip(){},error:'Check this answer',notice:'Local draft only'};console.log(JSON.stringify({normal:renderToStaticMarkup(React.createElement(QuestionScreen,props,React.createElement('textarea',{'aria-label':'Business description'}))),pending:renderToStaticMarkup(React.createElement(QuestionScreen,{...props,pending:true,nextType:'submit',nextLabel:'Create my business'}))}));`) as { normal: string; pending: string };
  assert.match(html.normal, /<h1[^>]*tabindex="-1"[^>]*>What does your business do\?/); assert.match(html.normal, /aria-label="Setup progress">Step 2 of 3/);
  assert.equal((html.normal.match(/<textarea/g) ?? []).length, 1); assert.doesNotMatch(html.normal, /<form/);
  assert.equal((html.normal.match(/<button type="button"/g) ?? []).length, 3); assert.match(html.normal, /role="alert"/); assert.match(html.normal, /role="status"/);
  assert.match(html.pending, /aria-busy="true"/); assert.match(html.pending, /<button type="submit"[^>]*disabled=""/); assert.equal((html.pending.match(/disabled=""/g) ?? []).length, 3);
});

test("actual first-owner form advances one answer at a time, preserves Back/refresh, prevents early Enter and keeps one complete final payload", () => {
  const result = evaluate(`
  const Module=require('node:module'),original=Module._load,slots=[];let cursor=0,serverCalls=0,serverFields={description:'Server requires a revised description'},action,actionState;
  const jsx=(type,props)=>({type,props:props||{}}),react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}];},useSyncExternalStore(){return true},useActionState(fn,initial){action=fn;return[actionState||initial,()=>{},false]}};
  Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='./actions')return{createFirstOwnerBusiness:async()=>{serverCalls++;return{status:'error',fields:serverFields,message:'Review details'}}};return original.call(this,name,...args)};
  const Form=require('./app/start/first-owner-form.tsx').FirstOwnerForm;Module._load=original;
  const items=new Map;global.window={sessionStorage:{getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)}};global.HTMLInputElement=class {};
  const root=Form({requestKey:'20000000-0000-4000-8000-000000000001',draftScopeKey:'10000000-0000-4000-8000-000000000001'}),render=()=>{cursor=0;return root.type(root.props)},screen=tree=>tree.props.children.find(n=>n.type&&n.type.name==='QuestionScreen'),control=tree=>screen(tree).props.children.find(n=>n?.type==='input'||n?.type==='textarea');
  let tree=render(),questions=[],prevented=0;questions.push(screen(tree).props.question);screen(tree).props.onNext();tree=render();const invalid=screen(tree).props.error;
  control(tree).props.onChange({target:{value:'Owner business'}});tree=render();tree.props.onKeyDown({key:'Enter',target:new HTMLInputElement,preventDefault(){prevented++}});tree=render();questions.push(screen(tree).props.question);
  control(tree).props.onChange({target:{value:'Owner supplied business description.'}});tree=render();screen(tree).props.onNext();tree=render();questions.push(screen(tree).props.question);
  screen(tree).props.onBack();tree=render();const preserved=control(tree).props.value;screen(tree).props.onNext();tree=render();control(tree).props.onChange({target:{value:'America/Chicago'}});tree=render();
  const hidden=tree.props.children.filter(n=>n?.type==='input').concat(tree.props.children.filter(Array.isArray).flat()),payload=hidden.map(n=>[n.props.name,n.props.value]),visibleNamed=!!control(tree).props.name;let blocked=false;tree.props.onSubmit({preventDefault(){blocked=true}});const beforeServerCalls=serverCalls;
  (async()=>{actionState=await action({status:'idle'},new FormData());tree=render();console.log(JSON.stringify({questions,invalid,preserved,prevented,payload,visibleNamed,blocked,beforeServerCalls,serverCalls,returnedStep:screen(tree).props.step,serverError:screen(tree).props.error,saved:JSON.parse([...items.values()][0])}));})().catch(()=>process.exitCode=1);
  `) as { questions: string[]; invalid: string; preserved: string; prevented: number; payload: [string, string][]; visibleNamed: boolean; blocked: boolean; beforeServerCalls: number; serverCalls: number; returnedStep: number; serverError: string; saved: { step: number; requestKey: string } };
  assert.deepEqual(result.questions, ["What is your business called?", "What does your business do?", "What timezone does your business use?"]);
  assert.match(result.invalid, /business name/); assert.equal(result.preserved, "Owner supplied business description."); assert.equal(result.prevented, 1);
  assert.deepEqual(result.payload, [["key", "20000000-0000-4000-8000-000000000001"], ["expectedActor", "10000000-0000-4000-8000-000000000001"], ["name", "Owner business"], ["description", "Owner supplied business description."], ["timezone", "America/Chicago"]]);
  assert.equal(result.visibleNamed, false); assert.equal(result.blocked, false); assert.equal(result.beforeServerCalls, 0); assert.equal(result.serverCalls, 1);
  assert.equal(result.returnedStep, 2); assert.equal(result.serverError, "Server requires a revised description"); assert.equal(result.saved.step, 1); assert.equal(result.saved.requestKey, result.payload[0][1]);
});

test("only the exact private onboarding route removes workspace chrome while retaining the actor-scoped private provider", () => {
  const result = evaluate(`const Module=require('node:module'),original=Module._load;let path='/client/onboarding';const jsx=(type,props)=>({type,props:props||{}}),mocks={
    react:{useEffect(){},useRef:()=>({current:null})},'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{usePathname:()=>path},
    '@/components/assistant/live-call-overlay':{LiveCallOverlay:'LiveCallOverlay'},'@/components/personal-assistant/launcher':{PersonalAssistantLauncher:'PersonalAssistantLauncher'},'@/components/personal-assistant/preferences-provider':{PersonalAssistantPreferencesProvider:'PrivateProvider'},
    '@/components/layout/workspace-chrome':{WorkspaceChrome:'WorkspaceChrome'},'@/components/business/daily-brief-shell':{DailyBriefShell:'DailyBriefShell'},'@/lib/business/owner-navigation':{isOwnerArea:p=>p==='/client',OWNER_AREAS:[]},'@/lib/branding':{brandStyleVariables:()=>({})},'@/components/onboarding/first-owner-draft':{clearFirstOwnerDraftAfterProvision(){}}
  };Module._load=function(name,...args){return mocks[name]||original.call(this,name,...args)};const {PortalShell}=require('./components/client/portal-shell.tsx');Module._load=original;
  const props={children:'Wizard question',banner:'Banner',accountActions:'Account actions',clientName:'Existing business',branding:{productName:'Existing agency',partnerName:'Existing agency'},experienceMode:'standard',userEmail:'owner@synthetic.invalid',visibleSections:['assistant'],unreadNotificationCount:0,businessWorkspace:true,personalAssistantScopeKey:'actor:business'};
  const inspect=tree=>{const types=[],markers=[];const walk=n=>{if(Array.isArray(n)){n.forEach(walk);return}if(!n||typeof n!=='object')return;types.push(n.type);if(n.props['data-business-onboarding-layout'])markers.push('onboarding');if(n.props['data-business-onboarding-layout']==='')markers.push('onboarding');if('data-business-onboarding-layout' in n.props)markers.push('layout');walk(n.props.children)};walk(tree);return{types,markers,scope:tree.props.scopeKey}};
  const exact=inspect(PortalShell(props));path='/client/onboarding/other';const nested=inspect(PortalShell(props));path='/client';const ordinary=inspect(PortalShell(props));console.log(JSON.stringify({exact,nested,ordinary}));`) as { exact: { types: string[]; markers: string[]; scope: string }; nested: { types: string[] }; ordinary: { types: string[] } };
  assert.equal(result.exact.scope, "actor:business"); assert.ok(result.exact.types.includes("PrivateProvider")); assert.ok(result.exact.markers.includes("layout"));
  for (const type of ["DailyBriefShell", "WorkspaceChrome", "PersonalAssistantLauncher", "LiveCallOverlay"]) assert.ok(!result.exact.types.includes(type), type);
  assert.ok(result.nested.types.includes("WorkspaceChrome")); assert.ok(result.nested.types.includes("PersonalAssistantLauncher")); assert.ok(result.nested.types.includes("LiveCallOverlay"));
  assert.ok(result.ordinary.types.includes("DailyBriefShell")); assert.ok(result.ordinary.types.includes("PrivateProvider")); assert.ok(result.ordinary.types.includes("PersonalAssistantLauncher"));
});
