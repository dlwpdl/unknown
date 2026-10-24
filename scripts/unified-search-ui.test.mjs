import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const ids = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
const city = { id: 'vancouver', name: '밴쿠버', englishName: 'Vancouver' };
const item = (kind='business', id=ids[0], extra={}) => ({ kind, id, cityId: city.id, title: '지모코', subtitle: '오스틴 지점', ...extra });
const page = (items=[item()],hasMore=false,nextOffset=items.length) => ({items,hasMore,nextOffset});
const settle = () => new Promise(setImmediate);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree,...Object.values(tree).flatMap(value=>Array.isArray(value)?value.flatMap(nodes):nodes(value))];
const text = tree => tree==null||typeof tree==='boolean'?'':typeof tree==='string'||typeof tree==='number'?String(tree):Array.isArray(tree)?tree.map(text).join(' '):text(tree.props?.children);
const control = (tree,id) => nodes(tree).find(node=>node.props?.testID===id||node.props?.analyticsId===id);
function screen({load=async()=>page(),initialQuery='',initialKind='all'}={}) {
  const file=new URL('../src/components/unified-search.tsx',import.meta.url);assert(existsSync(file),'Unified search UI is not implemented');
  const slots=[],cleanups=[],passive=[],timers=[],calls=[],routes=[],feedback=[];
  let at=0,defer=false,focused=true,account='viewer',loading=false,hidden=()=>false;
  const hooks={
    useState(initial){const i=at++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value;}];},
    useRef(initial){const i=at++;return slots[i]??={current:initial};},
    useMemo(fn,deps){const i=at++;if(!slots[i]||deps.some((value,n)=>value!==slots[i].deps[n]))slots[i]={value:fn(),deps};return slots[i].value;},
    useEffect(fn,deps){const i=at++;if(!slots[i]||deps.some((value,n)=>value!==slots[i][n])){slots[i]=deps;const run=()=>{if(slots[i]!==deps)return;cleanups[i]?.();cleanups[i]=fn();};if(defer)passive.push(run);else run();}},
    useLayoutEffect(fn,deps){const i=at++;if(!slots[i]||deps.some((value,n)=>value!==slots[i][n])){cleanups[i]?.();slots[i]=deps;cleanups[i]=fn();}},
  };
  const modules={
    react:hooks,'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},
    'react-native':{View:'View',TextInput:'TextInput',Keyboard:{dismiss(){}},Platform:{OS:'ios'},StyleSheet:{create:x=>x,hairlineWidth:1},useWindowDimensions:()=>({width:390,fontScale:1})},
    'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'expo-image':{Image:'Image'},'expo-symbols':{SymbolView:'Symbol'},
    'expo-router':{useIsFocused:()=>focused,useRouter:()=>({push:route=>routes.push(route),canGoBack:()=>true,back:()=>routes.push('back'),replace:route=>routes.push(route)})},
    '@/components/analytics-controls':{Pressable:'Pressable',FlatList:'FlatList'},'@/components/selection-chip':{SelectionChip:'Chip'},'@/components/state-card':{StateCard:'StateCard'},'@/components/themed-text':{ThemedText:'Text'},'@/components/gling-loader':{GlingLoader:'Loader'},
    '@/constants/theme':{Spacing:{one:4,two:8,three:12,four:16,five:20,six:24},MaxContentWidth:800},'@/constants/design-system':{ControlStyles:{icon:{},pill:{},field:{},action:{}},ControlMetrics:{touch:44},IconSize:{toolbar:21},Typography:{body:{fontSize:16}}},
    '@/hooks/use-language':{useLanguage:()=>({language:'ko',tr:x=>x})},'@/hooks/use-theme':{useTheme:()=>({})},'@/hooks/use-content-visibility':{useContentVisibility:()=>hidden},
    '@/lib/auth':{useAuth:()=>({isAuthed:!!account,isAuthLoading:loading,me:{id:account??'guest'}})},'@/lib/mock':{CITIES:[city,{id:'toronto',name:'토론토',englishName:'Toronto'}]},
    '@/lib/supabase':{supabase:{}},'@/lib/interaction-feedback':{useInteractionFeedback:()=>({play:value=>feedback.push(value)})},
    '@/lib/unified-search':{loadUnifiedSearch:(_client,options)=>{calls.push(options);return load(options);}},
  };
  const exports={},code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{exports,AbortController,Symbol,Map,Set,setTimeout:fn=>{const timer={fn,active:true};timers.push(timer);return timer;},clearTimeout:timer=>{timer.active=false;},require:name=>{assert(name in modules,name);return modules[name];}});
  return{calls,routes,feedback,account(value){account=value;},focus(value){focused=value;},loading(value){loading=value;},hide(fn){hidden=fn;},defer(value){defer=value;},flushPassive(){passive.splice(0).forEach(fn=>fn());},async flush(){timers.splice(0).filter(timer=>timer.active).forEach(timer=>timer.fn());await settle();},
    render(){at=0;let tree=exports.UnifiedSearch({initialCityId:city.id,initialQuery,initialKind});if(typeof tree.type==='function')tree=tree.type(tree.props);const list=nodes(tree).find(node=>node.type==='FlatList');return{tree,list,rows:list?.props.data.map((item,index)=>list.props.renderItem({item,index}))??[],empty:list?.props.ListEmptyComponent,footer:list?.props.ListFooterComponent};},
    unmount(){cleanups.forEach(fn=>fn?.());timers.forEach(timer=>{timer.active=false;});},
  };
}
const rowControl = view => view.rows.flatMap(nodes).find(node=>node.props?.analyticsId?.startsWith('search.result.'));

test('search route validates entry values and defaults to the current city without changing it',()=>{
  const file=new URL('../src/app/search.tsx',import.meta.url);assert(existsSync(file));
  let params={},writes=0;const exports={},modules={'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key})},'expo-router':{useLocalSearchParams:()=>params},'@/lib/community-city':{useCommunityCity:()=>({city,setCity(){writes++;}})},'@/lib/mock':{CITIES:[city]},'@/components/unified-search':{UnifiedSearch:'UnifiedSearch'}};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;vm.runInNewContext(code,{exports,require:name=>modules[name]??{}});
  let tree=exports.default();assert.equal(tree.props.initialCityId,city.id);assert.equal(tree.props.initialKind,'all');
  params={cityId:'not-a-city',kind:'private',query:'#파스타'};tree=exports.default();assert.equal(tree.props.initialCityId,city.id);assert.equal(tree.props.initialKind,'post');assert.equal(tree.props.initialQuery,'#파스타');assert.equal(writes,0);
});

test('current city is the default; Canada and kind controls are explicit local search changes',async()=>{
  const app=screen();let view=app.render();assert.equal(app.calls.length,0);
  nodes(view.tree).find(node=>node.type==='TextInput').props.onChangeText('Jimoco');app.render();await app.flush();view=app.render();
  assert.equal(app.calls[0].cityId,city.id);assert.equal(app.calls[0].kind,'all');assert.equal(app.calls[0].query,'Jimoco');
  control(view.tree,'search.scope.canada').props.onPress();app.render();await app.flush();view=app.render();assert.equal(app.calls.at(-1).cityId,null);
  control(view.tree,'search.kind.person').props.onPress();app.render();await app.flush();assert.equal(app.calls.at(-1).kind,'person');
  assert.ok(app.feedback.includes('selection'));app.unmount();
});

test('All shows three per group, group more selects that kind, and Canada results include their city',async()=>{
  const many=['business','place','person','post','meetup'].flatMap(kind=>[0,1,2,3].map((n)=>item(kind,`${kind}-${n}`,{cityId:n===0?'toronto':city.id})));
  const app=screen({initialQuery:'지모코',load:async()=>page(many)});app.render();await app.flush();let view=app.render();
  assert.equal(view.rows.flatMap(nodes).filter(node=>node.props?.analyticsId?.startsWith('search.result.')).length,15);
  const more=view.rows.flatMap(nodes).find(node=>node.props?.analyticsId==='search.group.more');more.props.onPress();app.render();await app.flush();assert.equal(app.calls.at(-1).kind,'business');
  view=app.render();control(view.tree,'search.scope.canada').props.onPress();app.render();await app.flush();view=app.render();assert.match(text(view.rows),/토론토/);app.unmount();
});

test('canonical results open existing company, user, post and map routes with exact branch identities',async()=>{
  const examples=[
    [item('business'),'/company/[id]',{id:ids[0]}],
    [item('person'),'/user/[id]',{id:ids[0]}],
    [item('post'),'/post/[id]',{id:ids[0]}],
    [item('post',ids[0],{merchantId:ids[1]}),'/post/[id]',{id:ids[0]}],
    [item('meetup'),'/post/[id]',{id:ids[0]}],
    [item('place','osm:123',{placeId:'osm:123'}),'/map',{cityId:city.id,placeId:'osm:123'}],
    [item('place','osm:124',{placeId:'osm:124',merchantId:ids[1]}),'/company/[id]',{id:ids[1]}],
  ];
  for(const [value,pathname,params]of examples){const app=screen({initialQuery:'지모코',load:async()=>page([value])});app.render();await app.flush();rowControl(app.render()).props.onPress();assert.equal(app.routes[0].pathname,pathname);assert.deepEqual(JSON.parse(JSON.stringify(app.routes[0].params)),params);app.unmount();}
});

test('bounded pagination is single-flight; a failed next page keeps results and the same retry offset',async()=>{
  let moreCalls=0;const app=screen({initialQuery:'지모코',initialKind:'business',load:async options=>{if(!options.offset)return page([item()],true,20);moreCalls++;if(moreCalls===1)throw Error('PRIVATE_FAILURE');return page([item('business',ids[1])],false,40);}});
  app.render();await app.flush();let view=app.render();const more=control(view.footer,'search.more');more.props.onPress();more.props.onPress();await settle();view=app.render();assert.equal(moreCalls,1);assert.equal(view.rows.flatMap(nodes).filter(node=>node.props?.analyticsId==='search.result.business').length,1);
  control(view.footer,'search.more').props.onPress();await settle();view=app.render();assert.equal(view.rows.flatMap(nodes).filter(node=>node.props?.analyticsId==='search.result.business').length,2);assert.deepEqual(app.calls.map(call=>call.offset??0),[0,20,20]);assert.doesNotMatch(text(view.footer),/PRIVATE_FAILURE/);app.unmount();
});

test('query, scope and account commits abort stale reads and prevent retained selections before passive cleanup',async()=>{
  const pending=[];const app=screen({initialQuery:'지모코',load:options=>new Promise(resolve=>pending.push({options,resolve}))});app.render();await app.flush();
  pending[0].resolve(page());await settle();let view=app.render();const retained=rowControl(view).props.onPress;
  app.defer(true);control(view.tree,'search.scope.canada').props.onPress();app.render();assert.equal(app.calls[0].signal.aborted,true);retained();assert.equal(app.routes.length,0);
  app.flushPassive();await app.flush();pending[1].resolve(page([item('business',ids[1])]));await settle();view=app.render();const old=rowControl(view).props.onPress;
  app.account('another-account');app.render();old();assert.equal(app.routes.length,0);assert.equal(pending[1].options.signal.aborted,true);app.unmount();
});

test('late read completion, same-account refocus, visibility changes and unmount cannot reopen old results',async()=>{
  let resolve;const app=screen({initialQuery:'first',load:()=>new Promise(done=>{resolve=done;})});let view=app.render();await app.flush();
  app.defer(true);nodes(view.tree).find(node=>node.type==='TextInput').props.onChangeText('second');app.render();resolve(page());await settle();assert.equal(rowControl(app.render()),undefined);app.unmount();
  const ready=screen({initialQuery:'지모코'});ready.render();await ready.flush();view=ready.render();const retained=rowControl(view).props.onPress;ready.defer(true);ready.focus(false);ready.render();ready.focus(true);ready.render();retained();assert.equal(ready.routes.length,0);
  ready.flushPassive();await ready.flush();view=ready.render();const current=rowControl(view).props.onPress;ready.hide(()=>true);ready.render();current();assert.equal(ready.routes.length,0);ready.unmount();current();assert.equal(ready.routes.length,0);
});

test('initial error, empty and loading states stay distinct and retry preserves the query and selected scope',async()=>{
  let reads=0;const app=screen({initialQuery:'Jimoco',load:async()=>{if(reads++===0)throw Error('PRIVATE_BACKEND_ERROR');return page([]);}});
  let view=app.render();assert.ok(nodes(view.empty).some(node=>node.type==='Loader'));
  await app.flush();view=app.render();const state=nodes(view.empty).find(node=>node.type==='StateCard');assert.equal(state.props.kind,'error');assert.doesNotMatch(JSON.stringify(state.props),/PRIVATE_BACKEND_ERROR/);
  state.props.onAction();app.render();await app.flush();view=app.render();assert.equal(nodes(view.empty).find(node=>node.type==='StateCard').props.kind,'empty');
  assert.equal(app.calls.at(-1).query,'Jimoco');assert.equal(app.calls.at(-1).cityId,city.id);app.unmount();
});

test('auth restoration blocks reads, typed hashtag selects posts, and identical names keep distinct branches',async()=>{
  const app=screen({load:async()=>page([item('business',ids[0]),item('business',ids[1],{subtitle:'다른 지점'})])});app.loading(true);let view=app.render();nodes(view.tree).find(node=>node.type==='TextInput').props.onChangeText('#지모코');app.render();await app.flush();assert.equal(app.calls.length,0);
  app.loading(false);app.render();await app.flush();view=app.render();assert.equal(app.calls[0].kind,'post');assert.equal(app.calls[0].query,'지모코');
  control(view.tree,'search.kind.business').props.onPress();app.render();await app.flush();view=app.render();
  const branches=view.rows.flatMap(nodes).filter(node=>node.props?.analyticsId==='search.result.business');assert.equal(branches.length,2);branches[0].props.onPress();branches[1].props.onPress();assert.deepEqual(app.routes.map(route=>route.params.id),ids.slice(0,2));app.unmount();
});

test('retained more and a late next page cannot mutate or reopen a newer query',async()=>{
  let finish;const app=screen({initialQuery:'first',initialKind:'business',load:options=>options.offset?new Promise(resolve=>{finish=resolve;}):Promise.resolve(page([item()],true,20))});
  app.render();await app.flush();let view=app.render();const more=control(view.footer,'search.more').props.onPress;more();
  app.defer(true);nodes(view.tree).find(node=>node.type==='TextInput').props.onChangeText('second');app.render();more();assert.equal(app.calls.length,2);assert.equal(app.calls[1].signal.aborted,true);
  finish(page([item('business',ids[1])],false,40));await settle();view=app.render();assert.equal(rowControl(view),undefined);app.unmount();
});

test('a query or scope committed before passive cleanup prevents an old debounce from starting a read',async()=>{
  const app=screen({initialQuery:'old query'});let view=app.render();app.defer(true);
  control(view.tree,'search.scope.canada').props.onPress();app.render();
  await app.flush();assert.equal(app.calls.length,0,'Layout invalidation blocks an old scheduled request before its passive cleanup');
  app.flushPassive();await app.flush();assert.equal(app.calls.length,1);assert.equal(app.calls[0].cityId,null);
  view=app.render();const select=rowControl(view).props.onPress;app.loading(true);app.render();select();assert.equal(app.routes.length,0,'Auth restoration also invalidates a retained result');app.unmount();
});
