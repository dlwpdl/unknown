import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const id = '70000000-0000-4000-8000-000000000001';
const folder = { id: '70000000-0000-4000-8000-000000000002', name: '주말' };
const item = { key: `merchant:${id}`, target: { kind: 'merchant', id }, savedAt: '2026-10-23T10:00:00Z', title: '저장한 비즈니스', subtitle: '밴쿠버', folderIds: [], hasWebshop: true };
const post = { ...item, key: 'post:1', target: { kind: 'post', id: '70000000-0000-4000-8000-000000000003' }, title: '저장한 글', hasWebshop: false };
const page = (items = [item], more = false) => ({ items, hasMore: more, nextCursor: more ? { savedAt: item.savedAt, key: item.key } : null });
const settle = () => new Promise(setImmediate);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(value => Array.isArray(value) ? value.flatMap(nodes) : nodes(value))];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : Array.isArray(tree) ? tree.map(text).join(' ') : text(tree.props?.children);
const control = (tree, id) => nodes(tree).find(node => (node.props?.testID ?? node.props?.analyticsId) === id);
const list = tree => nodes(tree).find(node => node.type === 'FlatList');
function screen(overrides = {}) {
  const state = [], cleanups = [], passive = [], calls = [], routes = [], feedback = [];
  let deferPassive = false;
  let index = 0, account = 'reader', focused = true, hidden = () => false;
  const hooks = {
    useState(initial) { const slot = index++; if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial; return [state[slot], value => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }]; },
    useRef(initial) { const slot = index++; return state[slot] ??= { current: initial }; },
    useCallback(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot].deps[i])) state[slot] = { fn, deps }; return state[slot].fn; },
    useEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { state[slot] = deps; const run = () => { if (state[slot] !== deps) return; cleanups[slot]?.(); cleanups[slot] = fn(); }; if (deferPassive) passive.push(run); else run(); } },
    useLayoutEffect(fn, deps) { const slot = index++; if (!state[slot] || deps.some((value, i) => value !== state[slot][i])) { cleanups[slot]?.(); state[slot] = deps; cleanups[slot] = fn(); } },
  };
  const actions = { loadSavedItems: async () => page(), loadSavedFolders: async () => [folder], setSavedItem: async (_client, target, saved) => ({ target, saved, available: true, savedAt: item.savedAt, folderIds: [] }), createSavedFolder: async (_client, name) => ({ ...folder, name }), renameSavedFolder: async (_client, id, name) => ({ id, name }), deleteSavedFolder: async () => {}, setSavedItemFolders: async () => {}, ...overrides };
  const api = Object.fromEntries(Object.entries(actions).map(([name, fn]) => [name, (...args) => { calls.push({ name, args: args.slice(1) }); return fn(...args); }]));
  const modules = {
    react: hooks, 'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-native': { FlatList: 'FlatList', View: 'View', TextInput: 'TextInput', ScrollView: 'ScrollView', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' }, 'expo-symbols': { SymbolView: 'Symbol' },
    'expo-router': { useRouter: () => ({ push: route => routes.push(JSON.parse(JSON.stringify(route))) }), useIsFocused: () => focused, useFocusEffect: fn => hooks.useEffect(() => focused ? fn() : undefined, [fn, focused]) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/login-panel': { LoginPanel: 'Login' }, '@/components/gling-loader': { GlingLoader: 'Loader' }, '@/components/state-card': { StateCard: 'StateCard' }, '@/components/themed-text': { ThemedText: 'Text' }, '@/components/themed-view': { ThemedView: 'View' },
    '@/components/saved-library': { SavedItemCard: 'SavedItemCard', SavedFolderSheet: 'SavedFolderSheet', SavedLibraryButton: 'SavedLibraryButton' },
    '@/components/business-webshop': { WebshopComparisonSheet: 'WebshopComparisonSheet' },
    '@/constants/theme': { Depth: {}, Spacing: { one: 4, two: 8, three: 16, four: 24, five: 32 }, MaxContentWidth: 800 }, '@/constants/design-system': { ControlStyles: { icon: {}, pill: {}, field: {} }, controlPresentation: () => ({ container: {}, text: {} }) },
    '@/hooks/use-theme': { useTheme: () => ({}) }, '@/hooks/use-language': { useLanguage: () => ({ language: 'ko', locale: 'ko-KR', tr: x => x, t: { profile: { savedLoading: '불러오는 중' } } }) }, '@/hooks/use-content-visibility': { useContentVisibility: () => hidden },
    '@/lib/auth': { useAuth: () => ({ isAuthed: !!account, isAuthLoading: false, me: { id: account ?? 'guest' } }) }, '@/lib/saved-items': api,
    '@/lib/webshops': { loadPublicWebshop: async (...args) => { calls.push({ name: 'loadPublicWebshop', args: args.slice(1) }); return overrides.offer ? overrides.offer(...args) : { merchantId: id }; } },
    '@/lib/supabase': { supabase: {} }, '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
  };
  const exported = {}, code = ts.transpileModule(readFileSync(new URL('../src/app/profile/saved.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports: exported, require: name => modules[name] ?? {}, setTimeout, clearTimeout, Date, Intl, Map });
  return { calls, routes, feedback, render({ deferEffects = false } = {}) { index = 0; deferPassive = deferEffects; try { return exported.default(); } finally { deferPassive = false; } }, flushPassive() { passive.splice(0).forEach(run => run()); }, account(value) { account = value; }, focus(value) { focused = value; }, hide(id) { hidden = (kind, target) => kind === 'post' && target === id; }, unmount() { cleanups.forEach(end => end?.()); } };
}

for (const [kind,route,target] of [['merchant','/company/[id]',{ kind:'merchant',id }],['post','/post/[id]',{ kind:'post',id }],['user','/user/[id]',{ kind:'user',id }],['place','/places/[id]',{ kind:'place',id:'osm:node:42',cityId:'vancouver' }]]) test(`saved ${kind} opens the exact public target`, async () => {
  const row={...item,target};const view=screen({loadSavedItems:async()=>page([row])});view.render();await settle();const root=view.render();
  assert.equal(view.calls[0].name,'loadSavedItems');assert.equal(view.calls[0].args[0].filter,'all');
  list(root).props.renderItem({item:row}).props.onOpen();assert.equal(view.routes[0].pathname,route);assert.equal(view.routes[0].params.id,target.id);if(kind==='place')assert.equal(view.routes[0].params.cityId,'vancouver');view.unmount();
});

test('filter, folder, account and lost-focus boundaries reject stale saved responses', async () => {
  const pending=[];const view=screen({loadSavedItems:(_client,args)=>new Promise(resolve=>pending.push({args,resolve}))});view.render();
  control(view.render(),'saved.filter.jobs').props.onPress();view.render();pending[0].resolve(page([item]));await settle();assert.equal(list(view.render()).props.data.length,0);
  pending[1].resolve(page([post]));await settle();assert.equal(list(view.render()).props.data[0].key,post.key);
  view.account('other');view.render();assert.equal(list(view.render()).props.data.length,0);pending[2].resolve(page([]));await settle();view.render();
  control(view.render(),`saved.folder.${folder.id}`).props.onPress();view.render();view.focus(false);view.render();pending[3].resolve(page([item]));await settle();assert.equal(list(view.render()).props.data.length,0);view.unmount();
});

test('query submit uses the current search and late old-query data remains hidden', async () => {
  const pending=[];const view=screen({loadSavedItems:(_client,args)=>new Promise(resolve=>pending.push({args,resolve}))});view.render();const input=nodes(view.render()).find(x=>x.type==='TextInput');input.props.onChangeText('정원');view.render();pending[0].resolve(page([item]));await settle();assert.equal(list(view.render()).props.data.length,0);nodes(view.render()).find(x=>x.type==='TextInput').props.onSubmitEditing();view.render();assert.equal(pending.at(-1).args.query,'정원');pending.at(-1).resolve(page([]));await settle();view.unmount();
});

test('pagination is single flight, retries the same cursor and deduplicates canonical keys', async () => {
  let fail,finish,attempt=0;const next={...item,key:'post:older',target:{kind:'post',id:post.target.id},title:'다음 글'};
  const view=screen({loadSavedItems:(_client,args)=>!args.cursor?Promise.resolve(page([item],true)):(attempt++,new Promise((resolve,reject)=>{finish=resolve;fail=reject;}))});view.render();await settle();let root=view.render();const more=control(root,'saved.more');more.props.onPress();more.props.onPress();assert.equal(attempt,1);fail(Error('offline'));await settle();root=view.render();assert.equal(list(root).props.data.length,1);control(root,'saved.retry').props.onPress();assert.equal(view.calls.at(-1).args[0].cursor.key,item.key);finish(page([item,next]));await settle();assert.equal(list(view.render()).props.data.length,2);view.unmount();
});

test('failed refresh and unsave preserve the loaded card and do not show a success state', async () => {
  let reads=true;const view=screen({loadSavedItems:async()=>{if(!reads)throw Error('PRIVATE server failure');return page();},setSavedItem:async()=>{throw Error('PRIVATE mutation failure');}});view.render();await settle();let root=view.render();reads=false;list(root).props.onRefresh();view.render();await settle();root=view.render();assert.equal(list(root).props.data.length,1);assert.ok(control(root,'saved.retry'));reads=true;control(root,'saved.retry').props.onPress();view.render();await settle();root=view.render();list(root).props.renderItem({item}).props.onRemove();await settle();root=view.render();assert.equal(list(root).props.data.length,1);assert.doesNotMatch(text(root),/PRIVATE/);assert.equal(view.feedback.includes('success'),false);view.unmount();
});

test('folder deletion keeps saved items and failed assignment keeps its editor and prior membership', async () => {
  const row={...item,folderIds:[folder.id]};const view=screen({loadSavedItems:async()=>page([row]),setSavedItemFolders:async()=>{throw Error('PRIVATE');}});view.render();await settle();let root=view.render();list(root).props.renderItem({item:row}).props.onOrganize();root=view.render();let sheet=nodes(root).find(x=>x.type==='SavedFolderSheet');sheet.props.onAssign([]);await settle();root=view.render();sheet=nodes(root).find(x=>x.type==='SavedFolderSheet');assert.ok(sheet);assert.deepEqual([...list(root).props.data[0].folderIds],[folder.id]);sheet.props.onClose();control(view.render(),`saved.folder.${folder.id}`).props.onPress();view.render();await settle();control(view.render(),'saved.folder.manage').props.onPress();root=view.render();sheet=nodes(root).find(x=>x.type==='SavedFolderSheet');sheet.props.onRequestDelete();root=view.render();sheet=nodes(root).find(x=>x.type==='SavedFolderSheet');await sheet.props.onDelete();await settle();view.render();await settle();assert.equal(list(view.render()).props.data.length,1);assert.equal(view.calls.some(c=>c.name==='setSavedItem'),false);view.unmount();
});

test('webshop action loads the current quote before mounting the existing tracked comparison sheet', async () => {
  let finish;const view=screen({offer:()=>new Promise(resolve=>{finish=resolve;})});view.render();await settle();list(view.render()).props.renderItem({item}).props.onCompare();assert.equal(nodes(view.render()).some(x=>x.type==='WebshopComparisonSheet'),false);finish({merchantId:id});await settle();const sheet=nodes(view.render()).find(x=>x.type==='WebshopComparisonSheet');assert.ok(sheet);assert.equal(sheet.props.shop.merchantId,id);assert.equal(view.calls.filter(c=>c.name==='loadPublicWebshop').length,1);view.account('other');assert.equal(nodes(view.render()).some(x=>x.type==='WebshopComparisonSheet'),false);view.unmount();
});

test('guests perform no saved reads and hidden posts disappear immediately', async () => {
  const guest=screen();guest.account(null);assert.equal(guest.render().type,'Login');await settle();assert.equal(guest.calls.length,0);guest.unmount();
  const view=screen({loadSavedItems:async()=>page([post])});view.render();await settle();assert.equal(list(view.render()).props.data.length,1);view.hide(post.target.id);assert.equal(list(view.render()).props.data.length,0);view.unmount();
});

test('focus rechecks current visibility and saved state without retaining removed targets', async () => {
  let available=true;const view=screen({loadSavedItems:async()=>page(available?[item]:[])});view.render();await settle();assert.equal(list(view.render()).props.data.length,1);
  view.focus(false);view.render();available=false;view.focus(true);view.render();await settle();assert.equal(list(view.render()).props.data.length,0);view.unmount();
});

test('verified unsave completing after same-account refocus triggers a fresh read', async () => {
  let finish,saved=true,reads=0;const view=screen({loadSavedItems:async()=>{reads++;return page(saved?[item]:[]);},setSavedItem:()=>new Promise(resolve=>{finish=()=>{saved=false;resolve({target:item.target,saved:false,available:true,savedAt:null,folderIds:[]});};})});
  view.render();await settle();list(view.render()).props.renderItem({item}).props.onRemove();view.focus(false);view.render();view.focus(true);view.render();await settle();assert.equal(reads,2);finish();await settle();view.render();await settle();assert.equal(reads,3);assert.equal(list(view.render()).props.data.length,0);view.unmount();
});

test('late mutations cannot remove another account saved item or show success there', async () => {
  let finish;const view=screen({setSavedItem:()=>new Promise(resolve=>{finish=resolve;})});view.render();await settle();list(view.render()).props.renderItem({item}).props.onRemove();view.account('other');view.render();await settle();finish({target:item.target,saved:false,available:true,savedAt:null,folderIds:[]});await settle();assert.equal(list(view.render()).props.data.length,1);assert.equal(view.feedback.includes('success'),false);view.unmount();
});

test('creating a folder while organizing is optional and does not assign membership until Done', async () => {
  const view=screen();view.render();await settle();list(view.render()).props.renderItem({item}).props.onOrganize();let sheet=nodes(view.render()).find(x=>x.type==='SavedFolderSheet');sheet.props.onCreateForItem([folder.id]);sheet=nodes(view.render()).find(x=>x.type==='SavedFolderSheet');sheet.props.onCreate('새 폴더');await settle();sheet=nodes(view.render()).find(x=>x.type==='SavedFolderSheet');assert.equal(sheet.props.editor.kind,'item');assert.equal(view.calls.some(c=>c.name==='setSavedItemFolders'),false);sheet.props.onClose();assert.equal(list(view.render()).props.data[0].folderIds.length,0);view.unmount();
});

function library(component, initialProps) {
  const state=[],feedback=[];let index=0,props=initialProps;
  const modules={react:{useState(initial){const slot=index++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];}},
    'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},
    'react-native':{View:'View',TextInput:'TextInput',ScrollView:'ScrollView',Modal:'Modal',KeyboardAvoidingView:'KeyboardAvoidingView',Platform:{OS:'web'},StyleSheet:{create:value=>value}},
    'expo-image':{Image:'Image'},'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},
    '@/components/analytics-controls':{Pressable:'Pressable'},'@/components/business-webshop':{UberOrderNotice:'UberOrderNotice'},'@/components/themed-text':{ThemedText:'Text'},
    '@/constants/design-system':{ControlStyles:{pill:{},field:{}},controlPresentation:()=>({container:{},text:{}})},'@/constants/theme':{Spacing:{one:4,two:8,three:16}},
    '@/hooks/use-language':{useLanguage:()=>({language:'ko'})},'@/hooks/use-theme':{useTheme:()=>({})},'@/lib/interaction-feedback':{useInteractionFeedback:()=>({play:value=>feedback.push(value)})}};
  const exported={},code=ts.transpileModule(readFileSync(new URL('../src/components/saved-library.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports:exported,require:name=>modules[name]??{}});
  return{feedback,render(next){if(next)props={...props,...next};index=0;return exported[component](props);}};
}
const editorProps=()=>({folders:[folder],busy:false,error:null,onClose(){},onCreate(){},onRename(){},onDelete(){},onAssign(){},onCreateForItem(){},onRequestDelete(){}});

test('folder form validates names and retains the draft after a rejected save',()=>{
  const names=[],view=library('SavedFolderSheet',{...editorProps(),editor:{kind:'create'},onCreate:name=>names.push(name)});
  let root=view.render();assert.equal(control(root,'saved.editor.submit').props.disabled,true);
  nodes(root).find(x=>x.type==='TextInput').props.onChangeText('  주말 산책  ');root=view.render();assert.equal(control(root,'saved.editor.submit').props.disabled,false);
  control(root,'saved.editor.submit').props.onPress();assert.deepEqual(names,['주말 산책']);root=view.render({error:'저장 실패'});assert.equal(nodes(root).find(x=>x.type==='TextInput').props.value,'  주말 산책  ');assert.match(text(root),/저장 실패/);
  nodes(root).find(x=>x.type==='TextInput').props.onChangeText('   ');assert.equal(control(view.render(),'saved.editor.submit').props.disabled,true);
});

test('folder membership remains local until explicit Done and supports no-folder saves',()=>{
  const assigned=[],view=library('SavedFolderSheet',{...editorProps(),editor:{kind:'item',item:{...item,folderIds:[folder.id]}},onAssign:ids=>assigned.push([...ids])});
  let root=view.render();const checkbox=control(root,`saved.editor.folder.${folder.id}`);assert.equal(checkbox.props.accessibilityState.checked,true);checkbox.props.onPress();root=view.render();assert.equal(control(root,`saved.editor.folder.${folder.id}`).props.accessibilityState.checked,false);assert.equal(assigned.length,0);control(root,'saved.editor.submit').props.onPress();assert.deepEqual(assigned,[[]]);assert.ok(view.feedback.includes('selection'));
});

test('closed jobs stay recognizable and webshop affordance requires current eligibility',()=>{
  const props={item:{...post,postType:'job',closed:true},folders:[],onOpen(){},onRemove(){},onOrganize(){},onCompare(){}};
  const view=library('SavedItemCard',props);assert.match(text(view.render()),/마감/);assert.equal(control(view.render(),`saved.compare.${post.key}`),undefined);
  const root=view.render({item});assert.ok(control(root,`saved.compare.${item.key}`));assert.ok(nodes(root).some(x=>x.type==='UberOrderNotice'));
});

test('visibility changes immediately dismiss an editor holding a previously visible target', async () => {
  const view=screen({loadSavedItems:async()=>page([post])});view.render();await settle();list(view.render()).props.renderItem({item:post}).props.onOrganize();assert.ok(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'));view.hide(post.target.id);assert.equal(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'),false);await settle();assert.equal(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'),false);view.unmount();
});

test('old folder editors do not reappear when switching away from and back to an account', async () => {
  const view=screen();view.render();await settle();list(view.render()).props.renderItem({item}).props.onOrganize();assert.ok(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'));view.account('other');view.render();await settle();view.account('reader');view.render();await settle();assert.equal(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'),false);view.unmount();
});

test('a focused refresh that removes a target also removes its cached folder editor', async () => {
  let available=true;const view=screen({loadSavedItems:async()=>page(available?[item]:[])});view.render();await settle();list(view.render()).props.renderItem({item}).props.onOrganize();view.focus(false);view.render();available=false;view.focus(true);view.render();await settle();assert.equal(nodes(view.render()).some(x=>x.type==='SavedFolderSheet'),false);view.unmount();
});

test('saved telemetry carries fixed action identifiers without target or folder identities',()=>{
  const root=library('SavedItemCard',{item,folders:[folder],onOpen(){},onRemove(){},onOrganize(){},onCompare(){}}).render();
  const ids=nodes(root).map(node=>node.props?.analyticsId).filter(Boolean);assert.deepEqual(ids,['saved.open.merchant','saved.organize','saved.remove','saved.compare']);assert.equal(ids.some(value=>value.includes(item.target.id)),false);
  const sheet=library('SavedFolderSheet',{...editorProps(),editor:{kind:'item',item}}).render();assert.equal(control(sheet,`saved.editor.folder.${folder.id}`).props.analyticsId,'saved.editor.select');
});

const writeNames = new Set(['setSavedItem','createSavedFolder','renameSavedFolder','deleteSavedFolder','setSavedItemFolders']);
async function retainedActions(view) {
  view.render();await settle();control(view.render(),`saved.folder.${folder.id}`).props.onPress();view.render();await settle();
  const row=list(view.render()).props.renderItem({item});const retained={remove:row.props.onRemove,compare:row.props.onCompare};
  row.props.onOrganize();let sheet=nodes(view.render()).find(node=>node.type==='SavedFolderSheet');const assign=sheet.props.onAssign;retained.assign=()=>assign([]);sheet.props.onClose();
  control(view.render(),'saved.folder.new').props.onPress();sheet=nodes(view.render()).find(node=>node.type==='SavedFolderSheet');const create=sheet.props.onCreate;retained.create=()=>create('새 폴더');sheet.props.onClose();
  control(view.render(),'saved.folder.manage').props.onPress();sheet=nodes(view.render()).find(node=>node.type==='SavedFolderSheet');const rename=sheet.props.onRename;retained.rename=()=>rename('바꾼 이름');sheet.props.onRequestDelete();sheet=nodes(view.render()).find(node=>node.type==='SavedFolderSheet');retained.delete=sheet.props.onDelete;sheet.props.onClose();
  return retained;
}
for(const action of ['remove','create','assign','rename','delete'])test(`retained ${action} handler cannot dispatch a write in a different account`,async()=>{
  const view=screen();const retained=await retainedActions(view);view.account('other-account');view.render();await settle();view.render();retained[action]();await settle();assert.deepEqual(view.calls.filter(call=>writeNames.has(call.name)),[],action);assert.equal(view.feedback.includes('success'),false);view.unmount();
});
for(const boundary of ['filter','folder','visibility','focus','pending-search'])test(`retained mutations reject the old ${boundary} scope before RPC dispatch`,async()=>{
  const view=screen();const retained=await retainedActions(view);
  if(boundary==='filter')control(view.render(),'saved.filter.jobs').props.onPress();
  else if(boundary==='folder')control(view.render(),'saved.folder.all').props.onPress();
  else if(boundary==='visibility')view.hide(post.target.id);
  else if(boundary==='focus'){view.focus(false);view.render();view.focus(true);}
  else nodes(view.render()).find(node=>node.type==='TextInput').props.onChangeText('다른 검색');
  view.render();await settle();view.render();for(const action of ['remove','create','assign','rename','delete']){retained[action]();await settle();assert.deepEqual(view.calls.filter(call=>writeNames.has(call.name)),[],action);}
  view.unmount();
});
test('layout scope invalidates retained writes and reads before passive focus cleanup',async()=>{
  const view=screen();const retained=await retainedActions(view);view.account('other-account');view.render({deferEffects:true});
  for(const action of ['remove','create','assign','rename','delete','compare']){retained[action]();await settle();assert.equal(view.calls.some(call=>writeNames.has(call.name)||call.name==='loadPublicWebshop'),false,action);}
  view.flushPassive();await settle();view.render();assert.equal(view.feedback.includes('success'),false);view.unmount();
});
