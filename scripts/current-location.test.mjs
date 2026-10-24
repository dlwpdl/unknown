import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {isFreshNearbyLocation} from '../src/lib/location.ts';
const settle=()=>new Promise(setImmediate);
function hook({permission={granted:true,canAskAgain:true},cached,current}={}){
  const file=new URL('../src/hooks/use-current-location.ts',import.meta.url);assert(existsSync(file),'Local current-location hook missing');
  const states=[],cleanups=[],passive=[],timers=[],calls=[],listeners=new Set(),sharing={enabled:false,calls:0};let index=0,focused=true,account='viewer',foreground='active',city='vancouver',defer=false,unmounted=false,lateWrites=0,clock=Date.now();
  const position=()=>({coords:{latitude:49.28,longitude:-122.8,accuracy:20},timestamp:clock,mocked:false});
  const hooks={
    useState(initial){const at=index++;if(!(at in states))states[at]=typeof initial==='function'?initial():initial;return[states[at],value=>{if(unmounted)lateWrites++;states[at]=typeof value==='function'?value(states[at]):value;}];},
    useRef(initial){const at=index++;return states[at]??={current:initial};},
    useMemo(fn,deps){const at=index++;if(!states[at]||deps.some((value,n)=>value!==states[at].deps[n]))states[at]={value:fn(),deps};return states[at].value;},
    useCallback(fn,deps){return hooks.useMemo(()=>fn,deps);},
    useEffect(fn,deps){const at=index++;if(!states[at]||deps.some((value,n)=>value!==states[at][n])){states[at]=deps;const run=()=>{if(states[at]!==deps)return;cleanups[at]?.();cleanups[at]=fn();};if(defer)passive.push(run);else run();}},
    useLayoutEffect(fn,deps){const at=index++;if(!states[at]||deps.some((value,n)=>value!==states[at][n])){cleanups[at]?.();states[at]=deps;cleanups[at]=fn();}},
  };
  const sdk={Accuracy:{Balanced:3},getForegroundPermissionsAsync:async()=>{calls.push('check');return permission;},requestForegroundPermissionsAsync:async()=>{calls.push('ask');return permission;},getLastKnownPositionAsync:async options=>{calls.push(['cached',options]);return cached===undefined?position():cached;},getCurrentPositionAsync:async options=>{calls.push(['current',options]);return current?current():position();}};
  const appState={get currentState(){return foreground;},addEventListener:(name,fn)=>{assert.equal(name,'change');listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
  const modules={react:hooks,'expo-location':sdk,'expo-router':{useIsFocused:()=>focused},'react-native':{AppState:appState,Linking:{openSettings:async()=>{calls.push('settings');}}},'@/lib/auth':{useAuth:()=>({isAuthed:!!account,isAuthLoading:false,me:{id:account??'guest'}})},'@/lib/location-provider':{useCommunityLocation:()=>({...sharing,capture(){sharing.calls++;throw Error('Distance must not enable server sharing');},record(){sharing.calls++;throw Error('Distance must not send a location event');}})},'@/lib/location':{isFreshNearbyLocation}};
  const exports={},code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,Date:{now:()=>clock},Promise,setTimeout:(fn,ms)=>{const timer={fn,ms,active:true};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.active=false;},require:name=>{assert(name in modules,`No backend/sharing provider is allowed: ${name}`);return modules[name];}});
  return{calls,timers,sharing,render(enabled=true){index=0;return exports.useCurrentLocation(city,enabled);},permission(next){permission=next;},city(next){city=next;},account(next){account=next;},focus(next){focused=next;},background(next){foreground=next;listeners.forEach(fn=>fn(next));},defer(next){defer=next;},flushPassive(){passive.splice(0).forEach(fn=>fn());},get lateWrites(){return lateWrites;},expire(){clock+=120001;timers.filter(timer=>timer.active&&timer.ms>15000).forEach(timer=>{timer.active=false;timer.fn();});},unmount(){cleanups.forEach(fn=>fn?.());unmounted=true;}};
}

test('already-granted permission reuses only a fresh precise native fix without requesting permission or enabling sharing',async()=>{
  const app=hook();app.render();await settle();const value=app.render();assert.equal(value.fix.latitude,49.28);assert.equal(value.status,'ready');assert.equal(app.calls.includes('ask'),false);assert.equal(app.calls.some(call=>Array.isArray(call)&&call[0]==='current'),false);
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.find(Array.isArray)[1])),{maxAge:120000,requiredAccuracy:250});app.expire();assert.equal(app.render().fix,null);assert.equal(app.calls.length,2,'Expiry invalidates display without another GPS sample');app.unmount();
});
test('denied OS permission does not sample or prompt automatically; explicit CTA can request or open settings',async()=>{
  const app=hook({permission:{granted:false,canAskAgain:true}});app.render();await settle();let value=app.render();assert.equal(value.status,'permission');assert.equal(value.fix,null);assert.deepEqual(app.calls,['check']);
  app.permission({granted:true,canAskAgain:true});await value.request();await settle();value=app.render();assert.equal(value.status,'ready');assert.ok(app.calls.includes('ask'));
  const blocked=hook({permission:{granted:false,canAskAgain:false}});blocked.render();await settle();await blocked.render().request();assert.deepEqual(blocked.calls,['check','settings']);assert.equal(blocked.render().fix,null);app.unmount();blocked.unmount();
});
test('coarse, invalid, mocked or stale coordinates cannot produce a distance fix',async()=>{
  for(const coords of [{latitude:NaN,longitude:-123,accuracy:20},{latitude:91,longitude:-123,accuracy:20},{latitude:49,longitude:181,accuracy:20},{latitude:49,longitude:-123,accuracy:500}]){
    const app=hook({cached:null,current:async()=>({coords,timestamp:Date.now(),mocked:false})});app.render();await settle();assert.equal(app.render().fix,null);assert.equal(app.render().status,'unavailable');app.unmount();
  }
  for(const change of [{mocked:true},{timestamp:Date.now()-120001}]){const app=hook({cached:null,current:async()=>({coords:{latitude:49,longitude:-123,accuracy:20},timestamp:Date.now(),mocked:false,...change})});app.render();await settle();assert.equal(app.render().fix,null);app.unmount();}
});
test('city/account/focus/background commits and unmount reject retained permission actions and late positions before passive cleanup',async()=>{
  const changes=[app=>app.city('toronto'),app=>app.account('other'),app=>app.focus(false),app=>app.background('background'),app=>app.unmount()];
  for(const [index,change] of changes.entries()){
    const app=hook({permission:{granted:false,canAskAgain:true}});app.render();await settle();const retained=app.render().request;app.defer(true);change(app);if(index!==changes.length-1)app.render();await retained();assert.equal(app.calls.includes('ask'),false);app.unmount();
  }
  let finish;const app=hook({cached:null,current:()=>new Promise(resolve=>{finish=resolve;})});app.render();await settle();app.unmount();finish({coords:{latitude:49,longitude:-123,accuracy:20},timestamp:Date.now(),mocked:false});await settle();assert.equal(app.lateWrites,0);
});
test('inactive nearby mode never touches GPS and two explicit requests remain single-flight',async()=>{
  const off=hook();off.render(false);await settle();assert.equal(off.calls.length,0);off.unmount();
  let finish;const app=hook({permission:{granted:false,canAskAgain:true},current:()=>new Promise(resolve=>{finish=resolve;})});app.render();await settle();const request=app.render().request;app.permission({granted:true,canAskAgain:true});const pending=request();await settle();await request();assert.equal(app.calls.filter(call=>call==='ask').length,1);finish({coords:{latitude:49,longitude:-123,accuracy:20},timestamp:Date.now(),mocked:false});await pending;app.unmount();
});


test('backend sharing opt-out is untouched by local OS-permitted distance reads',async()=>{
  const app=hook();assert.equal(app.sharing.enabled,false);app.render();await settle();assert.ok(app.render().fix);assert.equal(app.sharing.enabled,false);assert.equal(app.sharing.calls,0);app.unmount();
});
