import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { toQR } from 'toqr';
import { sharedLinkTarget, SHARED_POST_RETURN_KEY } from '../src/lib/sharing.ts';
import { publicWebTarget } from '../src/lib/public-web.ts';
import { publicSiteName } from '../src/lib/public-seo.ts';

const id='c8f9cd5e-b0a8-46e3-a9d5-462f0c3a24b8',other='70000000-0000-4000-8000-000000000001';
const canonical=`https://gling.ej-entertainment.com/post?id=${id}`;
const preview={id,title:'공유한 공개 제목',teaser:'서버가 허용한 짧은 소개',kind:'post',city:'밴쿠버',label:'비즈니스',schedule:null,imagePath:null,closed:false};
const nodes=root=>!root||typeof root!=='object'?[]:[root,...Object.values(root).flatMap(value=>Array.isArray(value)?value.flatMap(nodes):nodes(value))];
const text=root=>root==null||typeof root==='boolean'?'':typeof root==='string'||typeof root==='number'?String(root):Array.isArray(root)?root.map(text).join(' '):text(root.props?.children);
const action=(tree,id)=>nodes(tree).find(node=>node.props?.['data-analytics']===id);
const settle=()=>new Promise(setImmediate);
function mount({href=canonical,load=async()=>preview,language='ko',copy=async()=>{},auth={isAuthed:false,isAuthLoading:false,me:{id:'guest'}},loadPost=async()=>null,hidden=()=>false,storageFailure=false,deferPassive=false}={}){
  const state=[],cleanups=[],calls=[],feedback=[],encoded=[],stored=new Map(),pendingEffects=[];let index=0;
  const location=new URL(href);
  const hooks={
    useState(initial){const slot=index++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return[state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value;}];},
    useRef(initial){const slot=index++;return state[slot]??={current:initial};},
    useLayoutEffect(fn,deps){const slot=index++;if(!state[slot]||deps.some((value,i)=>value!==state[slot][i])){cleanups[slot]?.();state[slot]=deps;cleanups[slot]=fn();}},
    useEffect(fn,deps){const slot=index++;if(!state[slot]||deps.some((value,i)=>value!==state[slot][i])){state[slot]=deps;const run=()=>{cleanups[slot]?.();cleanups[slot]=fn();};if(deferPassive)pendingEffects.push(run);else run();}},
    useMemo(fn,deps){const slot=index++;if(!state[slot]||deps.some((value,i)=>value!==state[slot].deps[i]))state[slot]={value:fn(),deps};return state[slot].value;},
    useSyncExternalStore(_subscribe,snapshot){index++;return snapshot();},
  };
  const modules={react:hooks,'react/jsx-runtime':{jsx:(type,props,key)=>({type,props,key}),jsxs:(type,props,key)=>({type,props,key})},
    'expo-router':{usePathname:()=>location.pathname,useLocalSearchParams:()=>Object.fromEntries(location.searchParams)},'expo-router/head':{default:'Head'},
    'expo-asset':{Asset:{fromModule:()=>({uri:'local-brand.png'})}},toqr:{toQR:input=>{encoded.push(input);return toQR(input);}},
    '@/constants/theme':{Colors:{dark:{}},Spacing:{three:16,four:24,five:32}},'@/constants/design-system':{ControlMetrics:{touch:44,action:48},Typography:{body:{fontSize:15,lineHeight:22},sheetTitle:{fontSize:24,lineHeight:32},menu:{fontSize:16,lineHeight:24},supporting:{fontSize:13,lineHeight:19}}},
    '@/hooks/use-theme':{useTheme:()=>({background:'#0B0B12',card:'#171722',text:'#F6F3F0',textSecondary:'#B7B4C3',line:'#343443',accent:'#CBB9FF',accentInk:'#171123',backgroundSelected:'#343443'})},
    '@/hooks/use-language':{useLanguage:()=>({language})},'@/lib/interaction-feedback':{useInteractionFeedback:()=>({play:kind=>feedback.push(kind)})},
    '@/lib/shared-link-preview':{loadSharedLinkPost:(client,postId)=>{calls.push(['post',client,postId,auth.me.id]);return loadPost(postId);},loadSharedLinkPreview:(client,postId)=>{calls.push(['preview',client,postId]);return load(postId);}},
    '@/lib/public-web-client':{publicWebClient:'ANON_ONLY'},'@/lib/public-seo':{publicSiteName,jsonLd:JSON.stringify,PUBLIC_SITE:'https://gling.ej-entertainment.com'},
    '@/lib/auth':{useAuth:()=>({...auth,promptLogin:reason=>calls.push(['login',reason])})},'@/hooks/use-content-visibility':{useContentVisibility:()=>hidden},'@/lib/supabase':{supabase:'AUTHENTICATED'},'./shared-post-article':{SharedPostArticle:'SharedPostArticle'},'@/lib/sharing':{sharedLinkTarget,SHARED_POST_RETURN_KEY},'@/lib/public-web':{publicWebTarget},'./analytics':{useReaderAnalytics(){}}};
  const exported={},source=ts.transpileModule(readFileSync(new URL('../src/components/public-web/shared-post-landing.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{exports:exported,require:name=>{if(name.includes('assets/brand/'))return'brand';assert.ok(name in modules,`Known preview-only import: ${name}`);return modules[name];},window:{location,addEventListener(){},removeEventListener(){},sessionStorage:{setItem:(key,value)=>{if(storageFailure)throw Error('PRIVATE_STORAGE_ERROR');stored.set(key,value);}}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},navigator:{clipboard:{writeText:value=>{calls.push(['copy',value]);return copy(value);}}},URL,URLSearchParams,Math,Map});
  return{calls,feedback,encoded,stored,location,flushPassive(){pendingEffects.splice(0).forEach(fn=>fn());},render(name='default',props){index=0;return exported[name](props);},unmount(){cleanups.forEach(fn=>fn?.());}};
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
test('preview copy and explicit app link preserve the exact post before any store choice',async()=>{
  const app=mount();let tree=app.render('SharedPostLandingContent',{postId:id,preview,status:'ready',onRetry(){}});
  assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(action(tree,'shared.web.same_post').props.href,canonical);assert.deepEqual(app.encoded,[]);
  assert.equal(nodes(tree).some(node=>node.type==='svg'),false,'A store QR appears only after an explicit choice');
  await action(tree,'shared.web.copy_link').props.onClick();await settle();tree=app.render('SharedPostLandingContent',{postId:id,preview,status:'ready',onRetry(){}});assert.deepEqual(app.calls,[['copy',canonical]]);assert.match(text(tree),/복사했어요/);assert.ok(app.feedback.includes('selection'));app.unmount();
});
test('guest preview offers normal web login while full body and comments stay private',()=>{
  const app=mount();const tree=app.render('SharedPostLandingContent',{postId:id,preview:{...preview,body:'PRIVATE_FULL_BODY',comments:['PRIVATE_COMMENT']},status:'ready',onRetry(){}});
  const copy=text(tree);assert.match(copy,/로그인.*가입/);assert.ok(action(tree,'shared.web.login'));assert.doesNotMatch(copy,/PRIVATE_/);assert.equal(nodes(tree).some(node=>node.props?.href&&/\/auth\/|accounts\.google|kauth\.kakao/.test(node.props.href)),false);assert.equal(action(tree,'shared.web.ios_store'),undefined);assert.equal(nodes(tree).some(node=>node.props?.href?.includes('play.google.com')),false);app.unmount();
});
test('meetup teasers stay hidden and nonready previews preserve handoff without cached fields',()=>{
  const app=mount();let tree=app.render('SharedPostLandingContent',{postId:id,preview:{...preview,kind:'meetup'},status:'ready',onRetry(){}});assert.doesNotMatch(text(tree),new RegExp(preview.teaser));
  for(const status of ['unavailable','error','loading']){tree=app.render('SharedPostLandingContent',{postId:id,preview,status,onRetry(){}});assert.doesNotMatch(text(tree),new RegExp(preview.title));assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(nodes(tree).some(node=>node.type==='svg'),false);}app.unmount();
});
test('copy failures stay honest and English content preserves destination',async()=>{
  const app=mount({language:'en',copy:async()=>{throw Error('PRIVATE clipboard');}});const props={postId:id,preview,status:'ready',onRetry(){}};let tree=app.render('SharedPostLandingContent',props);await action(tree,'shared.web.copy_link').props.onClick();await settle();tree=app.render('SharedPostLandingContent',props);assert.match(text(tree),/copy/i);assert.doesNotMatch(text(tree),/PRIVATE/);action(tree,'shared.web.store.android').props.onClick();tree=app.render('SharedPostLandingContent',props);assert.match(text(tree),/Android.*public release on the way/i);assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);app.unmount();
});

test('public providers retain normal login, signup and profile onboarding gates on shared routes',()=>{
  let path='/',language='ko';const document={documentElement:{lang:'ko'}},exported={};const modules={
    react:{useEffect:effect=>effect()},'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
    'expo-router':{DarkTheme:'dark',ThemeProvider:'ThemeProvider',usePathname:()=>path},
    '@/hooks/use-language':{LanguagePreferenceProvider:'LanguageProvider',useLanguage:()=>({language})},'react-native-safe-area-context':{SafeAreaProvider:'SafeAreaProvider'},'@/hooks/use-theme':{ThemeOverrideProvider:'ThemeOverrideProvider'},
    '@/lib/auth':{AuthProvider:'AuthProvider'},'@/lib/community-city':{CommunityCityProvider:'CommunityCityProvider'},'@/lib/interaction-feedback':{InteractionFeedbackProvider:'InteractionFeedbackProvider'},'@/lib/membership-provider':{MembershipProvider:'MembershipProvider'}};
  const code=ts.transpileModule(readFileSync(new URL('../src/components/public-web/providers.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports:exported,document,require:name=>modules[name]??{}});
  for(const route of ['/post',`/post/${id}`,`/share/${id}`,'/','/company','/auth/callback','/profile','/postman']){path=route;const tree=exported.PublicWebProviders({children:'same-child'});assert.equal(nodes(tree).find(node=>node.type==='AuthProvider').props.publicPage??false,false,route);assert.match(text(tree),/same-child/);assert.equal(nodes(tree).find(node=>node.type==='LanguageProvider').props.initialLanguage,'ko');}
});

test('valid private or failed previews retain exact app destination and explicit web access gate',async()=>{
  for(const load of [async()=>null,async()=>{throw Error('PRIVATE preview error');}]){
    const route=mount({load});route.render();await settle();const props=route.render().props;const app=mount();const tree=app.render('SharedPostLandingContent',props);
    assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);assert.equal(action(tree,'shared.web.same_post').props.href,canonical);assert.deepEqual(app.encoded,[]);assert.doesNotMatch(text(tree),/PRIVATE|공유한 공개 제목/);assert.match(text(tree),/로그인|권한/);assert.match(text(tree),/삭제/);route.unmount();app.unmount();
  }
});
test('invalid or missing destinations have invalid-link copy and never create a QR or app handoff',()=>{
  for(const postId of [null,'javascript:alert(1)','not-a-uuid']){const app=mount();const tree=app.render('SharedPostLandingContent',{postId,preview:null,status:'unavailable',onRetry(){}});assert.equal(action(tree,'shared.web.open_app'),undefined);assert.equal(action(tree,'shared.web.copy_link'),undefined);assert.equal(nodes(tree).some(node=>node.type==='svg'),false);assert.deepEqual(app.encoded,[]);assert.match(text(tree),/링크/);app.unmount();}
});


test('web login preserves the exact shared post before opening the normal signup/login panel', () => {
  const app=mount({href:canonical+'&invite=1'});
  let props=app.render().props;
  assert.equal(typeof props.onLogin,'function');
  props.onLogin();
  assert.equal(app.stored.get(SHARED_POST_RETURN_KEY),`/post?id=${id}&invite=1`);
  assert.equal(app.calls.filter(call=>call[0]==='login').length,1);
  assert.ok(app.feedback.includes('selection'));
  const denied=mount({storageFailure:true});denied.render().props.onLogin();
  props=denied.render().props;
  assert.ok(props.loginError);assert.doesNotMatch(props.loginError,/PRIVATE_/);
  assert.equal(denied.calls.some(call=>call[0]==='login'),false);
  app.unmount();denied.unmount();
});

test('full web reading waits for completed auth/onboarding and uses only the authenticated same-post loader',async()=>{
  const auth={isAuthed:true,isAuthLoading:true,me:{id:'owner-a'}};
  const full={id,title:'웹에서 읽을 전체 글',body:'AUTHORIZED_BODY',author:{id:'author-a'},tag:{label:'이야기'}};
  const app=mount({auth,loadPost:async()=>full});app.render();await settle();
  assert.equal(app.calls.some(call=>call[0]==='post'),false);
  assert.equal(app.render().props.post,null);
  auth.isAuthLoading=false;app.render();await settle();
  let props=app.render().props;
  assert.equal(props.post.body,'AUTHORIZED_BODY');assert.equal(props.authenticated,true);
  assert.deepEqual(app.calls.filter(call=>call[0]==='post'),[['post','AUTHENTICATED',id,'owner-a']]);
  auth.isAuthed=false;props=app.render().props;assert.equal(props.post,null,'Sign-out immediately discards the full post');app.unmount();
});

test('account changes, hidden content, mismatched IDs and unmount discard late authorized reads',async()=>{
  const auth={isAuthed:true,isAuthLoading:false,me:{id:'owner-a'}},pending=[];
  let hidden=false;
  const full={id,title:'Authorized title',body:'AUTHORIZED_BODY',author:{id:'author-a'}};
  const app=mount({auth,hidden:()=>hidden,loadPost:()=>new Promise(resolve=>pending.push(resolve))});
  app.render();auth.me={id:'owner-b'};app.render();pending[0](full);await settle();
  assert.equal(app.render().props.post,null,'Previous account cannot populate current account');
  pending[1](full);await settle();assert.equal(app.render().props.post.body,'AUTHORIZED_BODY');
  hidden=true;assert.equal(app.render().props.post,null,'Existing account-scoped block/report overlay immediately hides the post');
  app.location.search=`?id=${other}`;app.render();app.unmount();pending[2]({...full,id:other});await settle();
  const mismatch=mount({auth,loadPost:async()=>({...full,id:other})});mismatch.render();await settle();assert.equal(mismatch.render().props.post,null);mismatch.unmount();
});

test('store picker creates only the selected store QR while the explicit post app link stays separate',()=>{
  const app=mount();const props={postId:id,preview,status:'ready',onRetry(){},onLogin(){}};
  let tree=app.render('SharedPostLandingContent',props);
  assert.equal(nodes(tree).filter(node=>node.type==='svg').length,0,'No store is guessed');
  action(tree,'shared.web.store.ios').props.onClick();tree=app.render('SharedPostLandingContent',props);
  assert.deepEqual(app.encoded,['https://apps.apple.com/ca/app/id6809273242']);
  assert.equal(nodes(tree).filter(node=>node.type==='svg').length,1);
  assert.equal(action(tree,'shared.web.ios_store').props.href,'https://apps.apple.com/ca/app/id6809273242');
  action(tree,'shared.web.store.android').props.onClick();tree=app.render('SharedPostLandingContent',props);
  assert.equal(app.encoded.at(-1),'https://play.google.com/store/apps/details?id=com.dlwpdl.gling');
  assert.equal(nodes(tree).filter(node=>node.type==='svg').length,1);
  assert.equal(action(tree,'shared.web.ios_store'),undefined);
  assert.match(text(tree),/비공개 테스트|private testing/);assert.match(text(tree),/공개 출시.*준비|public release on the way/);
  assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}`);
  assert.ok(app.feedback.includes('selection'));app.unmount();
});


test('retained web login cannot write a return path or prompt after a different scope commits before passive effects',()=>{
  const changes=[
    (app,auth)=>{auth.isAuthed=true;auth.me={id:'signed-in-account'};},
    (app,auth)=>{auth.me={id:'different-guest-account'};},
    (app,auth)=>{auth.isAuthLoading=true;},
    app=>{app.location.search=`?id=${other}`;},
    app=>{app.location.search=`?id=${id}&invite=1`;},
    app=>{app.location.pathname=`/share/${id}`;app.location.search='';},
    app=>{app.unmount();},
  ];
  for(const change of changes){
    const auth={isAuthed:false,isAuthLoading:false,me:{id:'guest'}};
    const app=mount({auth,deferPassive:true});
    const retained=app.render().props.onLogin;app.flushPassive();
    change(app,auth);if(change!==changes.at(-1))app.render();
    retained();
    assert.equal(app.stored.size,0,'Stale login must not overwrite another return intent');
    assert.equal(app.calls.filter(call=>call[0]==='login').length,0,'Stale login must not reopen authentication');
    app.unmount();
  }
});

test('a selected meetup invites signup and app participation while ordinary shared posts keep web reading', () => {
  const app = mount();
  const props = { postId:id, preview:{...preview,kind:'meetup'}, invite:true, status:'ready', onRetry(){}, onLogin(){} };
  let tree = app.render('SharedPostLandingContent',props);
  assert.match(text(tree),/로그인·가입하고 이어가기/);
  assert.match(text(tree),/모임 참여는 앱/);
  assert.equal(action(tree,'shared.web.open_app').props.href,`gling://post/${id}?invite=1`);
  tree = app.render('SharedPostLandingContent',{...props,invite:false,preview});
  assert.match(text(tree),/로그인·가입하고 읽기/);
  app.unmount();
});
