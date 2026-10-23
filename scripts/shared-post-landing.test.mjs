import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { toQR } from 'toqr';
import { sharedLinkTarget } from '../src/lib/sharing.ts';
import { publicWebTarget } from '../src/lib/public-web.ts';

const id='c8f9cd5e-b0a8-46e3-a9d5-462f0c3a24b8',other='70000000-0000-4000-8000-000000000001';
const canonical=`https://gling.ej-entertainment.com/post?id=${id}`;
const preview={id,title:'공유한 공개 제목',teaser:'서버가 허용한 짧은 소개',kind:'post',city:'밴쿠버',label:'비즈니스',schedule:null,imagePath:null,closed:false};
const nodes=root=>!root||typeof root!=='object'?[]:[root,...Object.values(root).flatMap(value=>Array.isArray(value)?value.flatMap(nodes):nodes(value))];
const text=root=>root==null||typeof root==='boolean'?'':typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):text(root.props?.children);
const action=(tree,id)=>nodes(tree).find(node=>node.props?.['data-analytics']===id);
const settle=()=>new Promise(setImmediate);
function mount({href=canonical,load=async()=>preview,language='ko',copy=async()=>{}}={}){
  const state=[],cleanups=[],calls=[],feedback=[],encoded=[];let index=0;
  const location=new URL(href);
  const hooks={
    useState(initial){const slot=index++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];},
    useEffect(fn,deps){const slot=index++;if(!state[slot]||deps.some((value,i)=>value!==state[slot][i])){cleanups[slot]?.();state[slot]=deps;cleanups[slot]=fn();}},
    useMemo(fn,deps){const slot=index++;if(!state[slot]||deps.some((value,i)=>value!==state[slot].deps[i]))state[slot]={value:fn(),deps};return state[slot].value;},
    useSyncExternalStore(_subscribe,snapshot){index++;return snapshot();},
  };
  const modules={react:hooks,'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},
    'expo-router':{usePathname:()=>location.pathname,useLocalSearchParams:()=>Object.fromEntries(location.searchParams)},'expo-router/head':{default:'Head'},
    'expo-asset':{Asset:{fromModule:()=>({uri:'local-brand.png'})}},toqr:{toQR:input=>{encoded.push(input);return toQR(input);}},
    '@/constants/theme':{Colors:{dark:{}},Spacing:{three:16,four:24,five:32}},'@/constants/design-system':{ControlMetrics:{touch:44,action:48},Typography:{body:{fontSize:15,lineHeight:22},sheetTitle:{fontSize:24,lineHeight:32},menu:{fontSize:16,lineHeight:24},supporting:{fontSize:13,lineHeight:19}}},
    '@/hooks/use-theme':{useTheme:()=>({background:'#0B0B12',card:'#171722',text:'#F6F3F0',textSecondary:'#B7B4C3',line:'#343443',accent:'#CBB9FF',accentInk:'#171123',backgroundSelected:'#343443'})},
    '@/hooks/use-language':{useLanguage:()=>({language})},'@/lib/interaction-feedback':{useInteractionFeedback:()=>({play:kind=>feedback.push(kind)})},
    '@/lib/shared-link-preview':{loadSharedLinkPreview:(client,postId)=>{calls.push(['preview',client,postId]);return load(postId);}},
    '@/lib/public-web-client':{publicWebClient:'ANON_ONLY'},'@/lib/public-seo':{PUBLIC_SITE:'https://gling.ej-entertainment.com'},
    '@/lib/sharing':{sharedLinkTarget},'@/lib/public-web':{publicWebTarget},'./analytics':{useReaderAnalytics(){}}};
  const exported={},source=ts.transpileModule(readFileSync(new URL('../src/components/public-web/shared-post-landing.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{exports:exported,require:name=>{if(name.includes('assets/brand/'))return'brand';assert.ok(name in modules,`Known preview-only import: ${name}`);return modules[name];},window:{location,addEventListener(){},removeEventListener(){}},navigator:{clipboard:{writeText:value=>{calls.push(['copy',value]);return copy(value);}}},URL,URLSearchParams,Math,Map});
  return{calls,feedback,encoded,location,render(name='default',props){index=0;return exported[name](props);},unmount(){cleanups.forEach(fn=>fn?.());}};
}

test('shared landing reads only anonymous preview for query and legacy routes',async()=>{
  for(const href of [canonical,`https://gling.ej-entertainment.com/post/${id}`,`https://gling.ej-entertainment.com/share/${id}`]){
    const app=mount({href});app.render();await settle();const tree=app.render();assert.equal(tree.props.status,'ready');assert.equal(tree.props.preview.title,preview.title);assert.deepEqual(app.calls,[['preview','ANON_ONLY',id]]);app.unmount();
  }
});
test('invalid duplicate IDs, removed previews and mismatched responses cannot become app handoffs',async()=>{
  for(const href of [`${canonical}&id=${other}`,'https://gling.ej-entertainment.com/post?id=javascript:alert(1)']){const app=mount({href});const tree=app.render();await settle();assert.equal(app.calls.length,0);assert.equal(tree.props.status,'unavailable');app.unmount();}
  for(const value of [null,{...preview,id:other}]){const app=mount({load:async()=>value});app.render();await settle();const tree=app.render();assert.equal(tree.props.status,'unavailable');assert.equal(tree.props.preview,null);app.unmount();}
});
test('route changes and unmount reject late preview responses, while errors offer a real retry',async()=>{
  const pending=[];const app=mount({load:postId=>new Promise((resolve,reject)=>pending.push({postId,resolve,reject}))});app.render();app.location.search=`?id=${other}`;app.render();pending[0].resolve(preview);await settle();assert.equal(app.render().props.status,'loading');pending[1].reject(Error('PRIVATE error'));await settle();let tree=app.render();assert.equal(tree.props.status,'error');tree.props.onRetry();app.render();assert.equal(pending.length,3);app.unmount();pending[2].resolve({...preview,id:other});await settle();
});
test('ready content uses the exact same canonical destination for local QR, copy and explicit app link',async()=>{
  const app=mount();let tree=app.render('SharedPostLandingContent',{postId:id,preview,status:'ready',onRetry(){}});
  assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(action(tree,'shared.web.same_post').props.href,canonical);assert.deepEqual(app.encoded,[canonical]);
  const svg=nodes(tree).find(node=>node.type==='svg');assert.equal(svg.props.role,'img');assert.ok(svg.props['aria-label']);assert.equal(svg.props.viewBox,'0 0 45 45');
  await action(tree,'shared.web.copy_link').props.onClick();await settle();tree=app.render('SharedPostLandingContent',{postId:id,preview,status:'ready',onRetry(){}});assert.deepEqual(app.calls,[['copy',canonical]]);assert.match(text(tree),/복사했어요/);assert.ok(app.feedback.includes('selection'));app.unmount();
});
test('app-only copy never asks for web OAuth, never exposes full body, and does not promise Android release',()=>{
  const app=mount();const tree=app.render('SharedPostLandingContent',{postId:id,preview:{...preview,body:'PRIVATE_FULL_BODY',comments:['PRIVATE_COMMENT']},status:'ready',onRetry(){}});
  const copy=text(tree);assert.match(copy,/앱에서/);assert.match(copy,/Android.*준비/);assert.doesNotMatch(copy,/PRIVATE_|로그인하고/);assert.equal(nodes(tree).some(node=>node.props?.href&&/\/auth\/|accounts\.google|kauth\.kakao/.test(node.props.href)),false);assert.equal(action(tree,'shared.web.ios_store').props.href,'https://apps.apple.com/ca/app/id6809273242');assert.equal(nodes(tree).some(node=>node.props?.href?.includes('play.google.com')),false);app.unmount();
});
test('meetup teasers stay hidden and nonready previews preserve handoff without cached fields',()=>{
  const app=mount();let tree=app.render('SharedPostLandingContent',{postId:id,preview:{...preview,kind:'meetup'},status:'ready',onRetry(){}});assert.doesNotMatch(text(tree),new RegExp(preview.teaser));
  for(const status of ['unavailable','error','loading']){tree=app.render('SharedPostLandingContent',{postId:id,preview,status,onRetry(){}});assert.doesNotMatch(text(tree),new RegExp(preview.title));assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(nodes(tree).some(node=>node.type==='svg'),true);}app.unmount();
});
test('copy failures stay honest and English content preserves destination',async()=>{
  const app=mount({language:'en',copy:async()=>{throw Error('PRIVATE clipboard');}});const props={postId:id,preview,status:'ready',onRetry(){}};let tree=app.render('SharedPostLandingContent',props);await action(tree,'shared.web.copy_link').props.onClick();await settle();tree=app.render('SharedPostLandingContent',props);assert.match(text(tree),/copy/i);assert.doesNotMatch(text(tree),/PRIVATE/);assert.match(text(tree),/Android.*prepar/i);assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);app.unmount();
});

test('public providers suppress global account gates only for shared-post entry routes',()=>{
  let path='/';const exported={};const modules={
    react:{},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'expo-router':{DarkTheme:'dark',ThemeProvider:'ThemeProvider',usePathname:()=>path},
    'react-native-safe-area-context':{SafeAreaProvider:'SafeAreaProvider'},'@/hooks/use-theme':{ThemeOverrideProvider:'ThemeOverrideProvider'},
    '@/lib/auth':{AuthProvider:'AuthProvider'},'@/lib/community-city':{CommunityCityProvider:'CommunityCityProvider'},'@/lib/interaction-feedback':{InteractionFeedbackProvider:'InteractionFeedbackProvider'},'@/lib/membership-provider':{MembershipProvider:'MembershipProvider'}};
  const code=ts.transpileModule(readFileSync(new URL('../src/components/public-web/providers.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports:exported,require:name=>modules[name]??{}});
  for(const [route,expected] of [['/post',true],[`/post/${id}`,true],[`/share/${id}`,true],['/',false],['/company',false],['/auth/callback',false],['/profile',false],['/postman',false]]){path=route;const tree=exported.PublicWebProviders({children:'same-child'});assert.equal(nodes(tree).find(node=>node.type==='AuthProvider').props.publicPage,expected,route);assert.match(text(tree),/same-child/);}
});

test('valid private or failed previews retain the exact app/QR destination while access remains gated',async()=>{
  for(const load of [async()=>null,async()=>{throw Error('PRIVATE preview error');}]){
    const route=mount({load});route.render();await settle();const props=route.render().props;const app=mount();const tree=app.render('SharedPostLandingContent',props);
    assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(action(tree,'shared.web.same_post').props.href,canonical);assert.deepEqual(app.encoded,[canonical]);assert.doesNotMatch(text(tree),/PRIVATE|공유한 공개 제목/);assert.match(text(tree),/로그인|권한/);assert.match(text(tree),/삭제/);route.unmount();app.unmount();
  }
});
test('invalid or missing destinations have invalid-link copy and never create a QR or app handoff',()=>{
  for(const postId of [null,'javascript:alert(1)','not-a-uuid']){const app=mount();const tree=app.render('SharedPostLandingContent',{postId,preview:null,status:'unavailable',onRetry(){}});assert.equal(action(tree,'shared.web.open_app'),undefined);assert.equal(action(tree,'shared.web.copy_link'),undefined);assert.equal(nodes(tree).some(node=>node.type==='svg'),false);assert.deepEqual(app.encoded,[]);assert.match(text(tree),/링크/);app.unmount();}
});
