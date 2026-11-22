import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

function flow(available: boolean) {
  const source = `const Module=require('node:module'),original=Module._load,slots=[],refs=[];let cursor=0,refCursor=0,calls=0,assigned=[];
  const jsx=(type,props)=>({type,props:props||{}}),react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}];},useRef(initial){const i=refCursor++;refs[i]??={current:initial};return refs[i]},useSyncExternalStore(){return true},useEffect(){}};
  Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};return original.call(this,name,...args)};const {GuestOwnerForm}=require('./components/onboarding/guest-owner-form.tsx');Module._load=original;
  const items=new Map;global.window={sessionStorage:{getItem:k=>items.get(k)||null,setItem:(k,v)=>items.set(k,v),removeItem:k=>items.delete(k)},location:{assign:url=>assigned.push(url)}};global.HTMLInputElement=class {};global.fetch=async()=>{calls++;return Response.json({url:'https://synthetic.supabase.co/auth/v1/authorize?provider=google'})};process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';
  const root=GuestOwnerForm({googleAvailable:${available}}),render=()=>{cursor=0;refCursor=0;return root.type(root.props)},screen=t=>t.props.children,find=n=>Array.isArray(n)?n.map(find).find(Boolean):n?.type==='input'||n?.type==='textarea'?n:n?.props?find(n.props.children):undefined,control=t=>find(screen(t).props.children);
  (async()=>{let tree=render(),questions=[],prevented=0;questions.push(screen(tree).props.question);await screen(tree).props.onNext();tree=render();const validation=screen(tree).props.error;
   control(tree).props.onChange({target:{value:'Owner business'}});tree=render();tree.props.onKeyDown({key:'Enter',target:new HTMLInputElement,preventDefault(){prevented++}});tree=render();questions.push(screen(tree).props.question);
   control(tree).props.onChange({target:{value:'Owner supplied business description.'}});tree=render();await screen(tree).props.onNext();tree=render();questions.push(screen(tree).props.question);screen(tree).props.onBack();tree=render();const retained=control(tree).props.value;await screen(tree).props.onNext();tree=render();control(tree).props.onChange({target:{value:'America/Chicago'}});tree=render();await screen(tree).props.onNext();tree=render();questions.push(screen(tree).props.question);const before=calls,disabled=screen(tree).props.nextDisabled;await screen(tree).props.onNext();await new Promise(done=>setImmediate(done));tree=render();console.log(JSON.stringify({questions,validation,prevented,retained,before,calls,assigned,disabled,step:tree.props['data-guest-step'],busy:tree.props['aria-busy'],saved:JSON.parse([...items.values()][0]),error:screen(tree).props.error}));})().catch(()=>process.exitCode=1);`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 })) as { questions: string[]; validation: string; prevented: number; retained: string; before: number; calls: number; assigned: string[]; disabled: boolean; step: number; busy: boolean; saved: { values: Record<string, string>; step: number }; error: string };
}
test("actual guest form keeps all three answers local, supports validation/Back/Enter and starts Google only on the final explicit action", () => {
  const result = flow(true);
  assert.deepEqual(result.questions, ["What is your business called?", "What does your business do?", "What timezone does your business use?", "Ready to continue with Google?"]);
  assert.match(result.validation, /business name/); assert.equal(result.prevented, 1); assert.equal(result.retained, "Owner supplied business description.");
  assert.equal(result.before, 0); assert.equal(result.calls, 1); assert.equal(result.step, 3); assert.equal(result.busy, true); assert.equal(result.assigned.length, 1);
  assert.deepEqual(result.saved.values, { name: "Owner business", description: "Owner supplied business description.", timezone: "America/Chicago" }); assert.equal(result.saved.step, 3);
});
test("unavailable Google setup keeps the same completed local draft and cannot start auth or display a fake connected state", () => {
  const result = flow(false);
  assert.equal(result.disabled, true); assert.equal(result.calls, 0); assert.deepEqual(result.assigned, []); assert.equal(result.step, 3); assert.equal(result.saved.values.name, "Owner business");
  assert.match(result.error, /not available here yet/); assert.doesNotMatch(result.error, /connected|success|workspace saved/i);
});

// Execute the actual component's effect callbacks against an injected browser
// EventTarget and deferred transport. This is lifecycle protocol evidence, not
// proof that Chromium chose to place a page in its real back-forward cache.
function lifecycle(mode: "leave" | "late-response" | "late-error" | "unmount" | "hide-unmount") {
  const source = `const Module=require('node:module'),original=Module._load,slots=[],refs=[],effects=[];let cursor=0,refCursor=0,effectCursor=0,mounted=true,lateUpdates=0,writes=0;
  const jsx=(type,props)=>({type,props:props||{}}),react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],v=>{if(!mounted)lateUpdates++;slots[i]=typeof v==='function'?v(slots[i]):v}];},useRef(initial){const i=refCursor++;refs[i]??={current:initial};return refs[i]},useSyncExternalStore(){return true},useEffect(callback,deps){const i=effectCursor++;if(!effects[i])effects[i]={callback,deps,run:false,cleanup:null};}};
  Module._load=function(name,...args){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};return original.call(this,name,...args)};const {GuestOwnerForm}=require('./components/onboarding/guest-owner-form.tsx');Module._load=original;
  const listeners=new Map,events=new EventTarget,items=new Map,requests=[],assigned=[],draft={version:1,draftId:'10000000-0000-4000-8000-000000000001',requestKey:'20000000-0000-4000-8000-000000000001',step:3,values:{name:'Synthetic owner',description:'Synthetic lifecycle acceptance business description.',timezone:'America/Chicago'},expiresAt:Date.now()+7200000};items.set('workstation:guest-owner:v1',JSON.stringify(draft));
  global.window={sessionStorage:{getItem:k=>items.get(k)||null,setItem:(k,v)=>{writes++;items.set(k,v)},removeItem:k=>items.delete(k)},addEventListener(name,fn){listeners.set(name,(listeners.get(name)||0)+1);events.addEventListener(name,fn)},removeEventListener(name,fn){listeners.set(name,(listeners.get(name)||0)-1);events.removeEventListener(name,fn)},location:{assign(url){assigned.push(url);dispatch('pagehide',false)}}};
  let storageUnchanged=true;function dispatch(name,persisted){const before=[...items],count=writes,e=new Event(name);Object.defineProperty(e,'persisted',{value:persisted});events.dispatchEvent(e);storageUnchanged&&=writes===count&&JSON.stringify([...items])===JSON.stringify(before)}
  global.fetch=(url,init)=>new Promise((resolve,reject)=>{requests.push({url,signal:init.signal,body:JSON.parse(init.body),resolve,reject})});process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.supabase.co';
  const root=GuestOwnerForm({googleAvailable:true}),render=()=>{cursor=0;refCursor=0;effectCursor=0;const tree=root.type(root.props);for(const effect of effects)if(!effect.run){effect.run=true;effect.cleanup=effect.callback()}return tree},screen=t=>t.props.children,view=t=>({busy:t.props['aria-busy'],pending:screen(t).props.pending,step:t.props['data-guest-step'],back:typeof screen(t).props.onBack==='function',error:screen(t).props.error}),turn=()=>new Promise(resolve=>setImmediate(resolve)),finish=(index,label)=>requests[index].resolve(Response.json({url:'https://synthetic.supabase.co/auth/v1/authorize?provider=google&fixture='+label}));
  const unmount=()=>{mounted=false;for(const effect of effects)effect.cleanup?.()},stages={};
  (async()=>{let tree=render();const initialListeners=[...listeners.values()].reduce((a,b)=>a+b,0);screen(tree).props.onNext();tree=render();stages.pending=view(tree);dispatch('pageshow',false);tree=render();stages.normalShow=view(tree);
   if(${JSON.stringify(mode)}==='leave'){finish(0,'first');await turn();tree=render();stages.leaving=view(tree);dispatch('pageshow',false);tree=render();stages.normalAfterLeave=view(tree);dispatch('pageshow',true);tree=render();stages.restored=view(tree);const beforeRetry=requests.length;await turn();stages.noAutomaticRetry=requests.length===beforeRetry;screen(tree).props.onNext();tree=render();stages.retry=view(tree);finish(1,'second');await turn();tree=render();dispatch('pageshow',true);tree=render();screen(tree).props.onBack();tree=render();stages.back=view(tree);unmount();}
   else if(${JSON.stringify(mode)}==='late-response'||${JSON.stringify(mode)}==='late-error'){dispatch('pagehide',true);const aborted=requests[0].signal.aborted;dispatch('pageshow',true);tree=render();stages.restored=view(tree);stages.aborted=aborted;const beforeRetry=requests.length;await turn();stages.noAutomaticRetry=requests.length===beforeRetry;screen(tree).props.onNext();tree=render();stages.retry=view(tree);if(${JSON.stringify(mode)}==='late-error')requests[0].reject(new Error('Synthetic old transport failure'));else finish(0,'old');await turn();tree=render();stages.afterOld=view(tree);stages.assignedAfterOld=assigned.length;screen(tree).props.onNext();tree=render();stages.callsAfterDuplicate=requests.length;finish(1,'new');await turn();tree=render();dispatch('pageshow',true);tree=render();screen(tree).props.onBack();tree=render();stages.back=view(tree);unmount();}
   else{if(${JSON.stringify(mode)}==='hide-unmount')dispatch('pagehide',true);unmount();dispatch('pageshow',true);finish(0,'unmounted');await turn();stages.aborted=requests[0].signal.aborted;}
   console.log(JSON.stringify({stages,initialListeners,remainingListeners:[...listeners.values()].reduce((a,b)=>a+b,0),lateUpdates,storageUnchanged,calls:requests.length,assigned,signalsAborted:requests.map(r=>r.signal.aborted),bodies:requests.map(r=>r.body),saved:JSON.parse(items.get('workstation:guest-owner:v1'))}));})().catch(error=>{console.error(error);process.exitCode=1});`;
  return JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "--eval", source], { encoding: "utf8", timeout: 15000, maxBuffer: 200000 })) as {
    stages: Record<string, { busy: boolean; pending: boolean; step: number; back: boolean; error: string } | boolean | number>;
    initialListeners: number; remainingListeners: number; lateUpdates: number; storageUnchanged: boolean; calls: number; assigned: string[]; signalsAborted: boolean[];
    bodies: { draftId: string; requestKey: string }[]; saved: { draftId: string; requestKey: string; step: number; values: Record<string, string> };
  };
}
function state(value: ReturnType<typeof lifecycle>, key: string) { const current = value.stages[key]; assert.ok(typeof current === "object"); return current; }
function kept(value: ReturnType<typeof lifecycle>) {
  assert.equal(value.storageUnchanged, true, "Page lifecycle events cannot rewrite local answers or generate replacement request IDs.");
  assert.equal(value.saved.draftId, "10000000-0000-4000-8000-000000000001"); assert.equal(value.saved.requestKey, "20000000-0000-4000-8000-000000000001");
  assert.deepEqual(value.saved.values, { name: "Synthetic owner", description: "Synthetic lifecycle acceptance business description.", timezone: "America/Chicago" });
  assert.ok(value.bodies.every(body => Object.keys(body).length === 2 && body.draftId === value.saved.draftId && body.requestKey === value.saved.requestKey));
  assert.equal(value.initialListeners, 2); assert.equal(value.remainingListeners, 0); assert.equal(value.lateUpdates, 0);
}
test("injected persisted pageshow restores a successfully leaving form for an explicit retry and Back without replacing its draft", () => {
  const result = lifecycle("leave");
  assert.equal(state(result, "leaving").busy, true); assert.equal(state(result, "normalAfterLeave").busy, true, "Normal pageshow cannot resume a pending navigation.");
  assert.equal(state(result, "restored").busy, false); assert.equal(state(result, "restored").pending, false); assert.equal(state(result, "restored").back, true); assert.equal(result.stages.noAutomaticRetry, true);
  assert.equal(state(result, "retry").busy, true); assert.equal(result.calls, 2); assert.equal(result.assigned.length, 2); assert.ok(result.assigned[0].endsWith("fixture=first")); assert.ok(result.assigned[1].endsWith("fixture=second"));
  assert.equal(state(result, "back").step, 2); assert.equal(result.saved.step, 2); kept(result);
});
test("pagehide aborts pending work and an old late success or finally cannot navigate or unlock a newer explicit request", () => {
  for (const mode of ["late-response", "late-error"] as const) {
    const result = lifecycle(mode);
    assert.equal(state(result, "normalShow").busy, true); assert.equal(result.stages.aborted, true); assert.equal(state(result, "restored").busy, false); assert.equal(result.stages.noAutomaticRetry, true);
    assert.equal(state(result, "retry").busy, true); assert.equal(state(result, "afterOld").busy, true); assert.equal(state(result, "afterOld").pending, true); assert.equal(state(result, "afterOld").error, "");
    assert.equal(result.stages.assignedAfterOld, 0); assert.equal(result.stages.callsAfterDuplicate, 2); assert.equal(result.calls, 2); assert.equal(result.assigned.length, 1); assert.ok(result.assigned[0].endsWith("fixture=new"));
    assert.equal(state(result, "back").step, 2); kept(result);
  }
});
test("actual component effect cleanup removes listeners, aborts pending work and ignores late responses after unmount", () => {
  for (const mode of ["unmount", "hide-unmount"] as const) {
    const result = lifecycle(mode);
    assert.equal(result.calls, 1); assert.deepEqual(result.assigned, []); assert.equal(result.stages.aborted, true); assert.equal(state(result, "normalShow").busy, true);
    assert.equal(result.saved.step, 3); kept(result);
  }
});
