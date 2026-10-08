// Reuse the slot-card harness pattern: actual cards, text, loader and RN Web styles.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const out = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const native = require('react-native-web');
const ts = require('typescript');
const symbols = require(path.join(root, 'node_modules/expo-symbols/build/android/symbols.json'));
const cache = new Map();
const mapUrl = 'https://www.google.com/maps/search/?api=1&query=Coal+Harbour+Vancouver';
const noop = () => {};

function StaticImage({ source, style, accessibilityLabel, resizeMode = 'contain' }) {
  return React.createElement(native.View, { accessibilityRole: 'image', accessibilityLabel, style: [{ overflow: 'hidden' }, style] },
    React.createElement('img', { src: source?.uri, alt: '', draggable: false, style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: resizeMode } }));
}

function localRequire(name) {
  if (name.endsWith('.css')) return {};
  if (name.startsWith('@/assets/')) return { uri: path.relative(out, path.join(root, name.slice(2))) };
  if (name === 'react-native') return { ...native, Image: StaticImage };
  if (name === 'react-native-reanimated') return { useReducedMotion: () => true };
  if (name === 'expo-image') return { Image: ({ contentFit, ...props }) => React.createElement(StaticImage, { ...props, resizeMode: contentFit }) };
  if (name === 'expo-symbols') return { SymbolView: ({ name, size = 24, tintColor }) => React.createElement(native.Text,
    { style: { width: size, height: size, fontSize: size, lineHeight: size, fontFamily: 'MaterialSymbols_400Regular', color: tintColor } }, String.fromCharCode(symbols[name.web])) };
  if (name === '@/lib/auth') return { useAuth: () => ({ isAuthed: false, me: { id: 'guest' }, promptLogin: noop }) };
  if (name === '@/lib/interaction-feedback') return { useInteractionFeedback: () => ({ play: noop }) };
  if (name === '@/components/report-sheet') return { ReportSheet: () => null };
  if (['@/lib/community-data', '@/lib/sharing', '@/lib/supabase'].includes(name)) return {};
  if (name === '@/lib/meetup-ai') return { visibleMeetupBody: body => body };
  if (name === '@/lib/feed-data') return { getPostImageSource: (post) => post.imageUris?.[0] ? { uri: post.imageUris[0] } : undefined };
  if (name === '@/components/analytics-controls') return { Pressable: ({ analyticsId, ...props }) => React.createElement(native.Pressable,
    { ...props, 'data-control': analyticsId, ...(analyticsId === 'components_post-map-link.pressable.1' ? { href: mapUrl, hrefAttrs: { target: '_blank', rel: 'noopener noreferrer' } } : {}) }) };
  if (!name.startsWith('@/')) return require(name);
  const base = path.join(root, 'src', name.slice(2));
  const filename = ['.web.ts', '.tsx', '.ts'].map(ext => base + ext).find(fs.existsSync);
  if (!filename) throw new Error(`Missing preview module: ${name}`);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: localRequire, URL }, { filename });
  return exports;
}

const { PostCard } = localRequire('@/components/post-card');
const { GlingLoader } = localRequire('@/components/gling-loader');
const { ThemeOverrideProvider } = localRequire('@/hooks/use-theme');
const { TAGS } = localRequire('@/lib/mock');
const themed = (scheme, element) => renderToStaticMarkup(React.createElement(ThemeOverrideProvider, { scheme }, element));
const photo = path.relative(out, path.join(root, 'assets/seed/vancouver-coal-harbour.jpg'));
const wordmark = path.relative(out, path.join(root, 'assets/brand/gling-night-wordmark.png'));
const wordmarkLight = path.relative(out, path.join(root, 'assets/brand/gling-night-wordmark-light.png'));
const base = { author: { id: 'sample', nickname: '이웃 예시', verified: false }, createdAtLabel: '시안 예시', likes: 4, saves: 2, comments: 1, views: 36, kind: 'story' };
const posts = [
  { ...base, id: 'sample-place', tag: TAGS.find(t => t.slug === 'travel'), title: '물가 산책, 여기서 시작해요', body: `동네 산책 장소를 소개하는 글의 예시예요. 제목 아래 사진을 보고, 이곳에 관한 이야기를 바로 이어 읽을 수 있어요. 지도 버튼으로 위치도 확인해 보세요.\n\nGoogle 지도: ${mapUrl}`, imageUris: [photo], imagePaths: ['example-photo'], hashtags: ['동네산책'] },
  { ...base, id: 'sample-business', author: { id: 'sample-shop', nickname: '업체 예시', verified: false }, tag: TAGS.find(t => t.slug === 'business'), title: '밴쿠버에서 새로 인사드립니다', body: '안녕하세요. 저희 가게를 소개하는 예시 글입니다. 어떤 곳인지, 무엇을 제공하는지 짧게 안내하고 궁금한 점은 편하게 문의하실 수 있도록 작성합니다.', hashtags: ['업체소개'] },
];
const phones = ['dark', 'light'].map(scheme => `<div class="phone" data-theme="${scheme}" ${scheme === 'light' ? 'hidden' : ''}>
  <header class="app-header"><img src="${scheme === 'light' ? wordmarkLight : wordmark}" alt="gling" width="96" height="40"><span>밴쿠버</span></header>
  <h2 class="today">오늘</h2><div class="filters" aria-label="시안 카테고리"><button type="button" data-filter="all" aria-pressed="true">전체</button>${TAGS.map(tag => `<button type="button" data-filter="${tag.slug}" aria-pressed="false">${tag.label}</button>`).join('')}</div>
  <div class="feed">${posts.map(post => `<article data-tag="${post.tag.slug}">${themed(scheme, React.createElement(PostCard, { post, flat: true, onPress: noop }))}</article>`).join('')}</div>
</div>`).join('');
const loaders = `<div class="loader-states"><div><span>일반 로딩</span>${themed('dark', React.createElement(GlingLoader))}</div><div><span>작은 로딩</span>${themed('dark', React.createElement(GlingLoader, { size: 18 }))}</div><div class="light-loader"><span>밝은 화면</span>${themed('light', React.createElement(GlingLoader))}</div></div>`;
const mapCode = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib/post-maps.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const css = native.StyleSheet.getSheet().textContent;
fs.copyFileSync(path.join(root, 'node_modules/@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.ttf'), path.join(out, 'symbols.ttf'));
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>글링 오늘 · 카드와 지도 링크 시안</title><style>${css}</style><style>
@font-face{font-family:MaterialSymbols_400Regular;src:url(symbols.ttf)}:root{--font-display:system-ui;--font-serif:serif;--font-rounded:system-ui;--font-mono:monospace;color-scheme:dark;accent-color:#CBB9FF}*{box-sizing:border-box}body{margin:0;background:#0B0B12;color:#F6F3F0;font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;line-height:1.6}main{max-width:1080px;margin:auto;padding:32px 24px 56px}h1{font-size:30px;letter-spacing:-.025em;line-height:1.3;margin:0 0 12px}p{color:#B7B4C3;max-width:68ch}h2{font-size:20px;margin:32px 0 12px}a{color:#CBB9FF;text-underline-offset:4px}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid #CBB9FF;outline-offset:4px}::selection{background:#8169B1;color:white}input{caret-color:#CBB9FF}button{font:inherit;color:inherit;border:1px solid #343443;background:#222231;border-radius:12px;min-height:44px;padding:8px 14px;cursor:pointer}button:active,a:active{opacity:.7}button:hover{background:#343443}.toolbar{display:flex;gap:12px;margin:24px 0;align-items:center;flex-wrap:wrap}.toolbar p{margin:0;font-size:13px}.layout{display:grid;grid-template-columns:minmax(0,440px) minmax(0,1fr);gap:40px;align-items:start}.phone{width:100%;background:#0B0B12;color:#F6F3F0;border:1px solid #343443;border-radius:16px;overflow:hidden}.phone[hidden]{display:none}.app-header{padding:16px 24px 0;display:flex;align-items:center;justify-content:space-between;font-size:14px;color:#B7B4C3}.app-header img{object-fit:contain}.today{margin:12px 24px;font-size:30px}.filters{display:flex;gap:8px;overflow:auto;padding:0 24px 16px;scrollbar-color:#8169B1 #222231;scrollbar-width:thin}.filters button{white-space:nowrap;flex-shrink:0;border-radius:12px;font-size:13px}.filters button[aria-pressed=true]{background:#CBB9FF;color:#171123}.feed article{border-top:1px solid #343443;padding:24px 16px}.feed article[hidden]{display:none}.phone[data-theme=light]{background:#FAF9F5;color:#21252C;border-color:#E5E3DB}.phone[data-theme=light] .app-header{color:#5B6270}.phone[data-theme=light] .feed article{border-color:#E5E3DB}.phone[data-theme=light] .filters button{background:#F1EFE8;border-color:#E5E3DB;color:#5B6270}.phone[data-theme=light] .filters button[aria-pressed=true]{background:#BE3B2A;color:white}.notes{padding-top:4px}.notes h2:first-child{margin-top:0}.notes ol{padding-left:24px;color:#B7B4C3}.notes li{margin:8px 0}.notes strong{color:#F6F3F0}.notes label{display:block;margin-top:12px;font-size:14px}.notes input{width:100%;font:inherit;font-size:14px;color:#F6F3F0;background:#171722;border:1px solid #343443;border-radius:12px;min-height:48px;padding:10px 12px;margin:8px 0;overflow-wrap:anywhere}.map-demo{min-height:44px;display:inline-flex;align-items:center;gap:8px;padding:10px 0}.map-demo[hidden]{display:none}#map-status{font-size:13px;margin-top:0}.loader-states{display:flex;gap:12px;flex-wrap:wrap}.loader-states>div{flex:1;min-width:100px;min-height:104px;background:#171722;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px;border-radius:12px;padding:16px 12px}.loader-states span{font-size:12px;color:#B7B4C3}.loader-states .light-loader{background:#FAF9F5}.light-loader span{color:#5B6270}details{border-top:1px solid #343443;margin-top:28px;padding-top:12px}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;color:#CBB9FF}.references{font-size:13px}.references a{display:inline-block;min-height:44px;padding:10px 0}footer{margin-top:36px;font-size:13px;color:#B7B4C3}@media(max-width:740px){main{padding:24px 16px 40px}h1{font-size:26px}.layout{grid-template-columns:minmax(0,1fr);gap:32px}.phone{max-width:440px;margin:auto}.toolbar{margin:20px 0}.notes{padding:0 8px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}
</style></head><body><main><h1>오늘의 글, 한눈에</h1><p>작성자와 제목 아래에 그 글의 사진과 본문이 이어집니다. 비즈니스 카테고리와 Google 지도 링크도 함께 확인해 보세요.</p>
<div class="toolbar"><button type="button" id="theme-toggle" aria-pressed="false">밝은 화면 보기</button><p>2026-10-08 · 시안용 예시 데이터</p></div><div class="layout"><section aria-label="실제 게시글 컴포넌트 시안">${phones}<p id="filter-status" role="status">전체 예시 글 2개</p></section>
<aside class="notes"><h2>글이 읽히는 순서</h2><ol><li><strong>작성자 · 작성 시간</strong></li><li><strong>카테고리 · 제목</strong></li><li>이 글에 첨부된 사진</li><li>본문 미리보기 · 지도 · 해시태그</li></ol><p>사진 없는 글도 같은 순서로 표시합니다. 본문은 피드에서 세 줄까지 보이고, 글을 열면 전체 내용을 읽습니다.</p>
<h2>소개한 장소로 바로 이동</h2><label for="map-input">Google 지도 공유 링크 (선택)</label><input id="map-input" type="url" inputmode="url" autocomplete="off" maxlength="2048" value="${mapUrl}" aria-describedby="map-status"><p id="map-status" role="status">아래 링크로 Google 지도를 열 수 있어요.</p><a class="map-demo" id="map-demo" href="${mapUrl}" target="_blank" rel="noopener noreferrer">Google 지도에서 보기 ↗</a><p>일반 글과 업체 소개 글에서 사용할 수 있습니다. 링크를 넣지 않은 글에는 지도 버튼이 표시되지 않습니다.</p>
<h2>현재 로고로 통일</h2>${loaders}<p>밝은 화면은 검은 글자·금색 점·투명 배경입니다. 어두운 화면은 기존 밝은 글자를 유지합니다.</p>
<details><summary>디자인 근거와 확인 범위</summary><div class="references"><p>실제 PostCard와 GlingLoader를 React Native Web으로 렌더했습니다. 필터·테마·지도는 이 시안에서 동작하며, 나머지 카드 동작은 앱에서 사용합니다. 게시나 신청 취소를 실행하지 않습니다.</p><a href="native-card-final.png">iOS 시뮬레이터의 오늘 카드 확인</a><br><a href="https://mobbin.com/screens/c1839d28-2bf7-45e9-86b3-8c962c1d4e12" target="_blank" rel="noopener noreferrer">Mobbin · LinkedIn의 작성자·글·사진 흐름</a><br><a href="https://mobbin.com/screens/2f833850-00e1-4e03-9e16-d76da36eb327" target="_blank" rel="noopener noreferrer">Mobbin · Corner의 장소와 사진 묶음</a><br><a href="https://mobbin.com/screens/ccbbd4d7-e1de-43c6-84d4-b5681c895f6c" target="_blank" rel="noopener noreferrer">Mobbin · Mindtrip의 장소·지도 이동 행동</a><br><a href="https://developers.google.com/maps/documentation/urls/guide" target="_blank" rel="noopener noreferrer">Google Maps URLs 공식 문서</a><p>밝은 로고는 원본 SVG의 글자색만 바꿔 렌더했습니다. 모양·금색 점·투명 영역은 그대로입니다. Apple Design의 읽기 순서·직접 행동·44px 이상 터치 영역을 적용했습니다. 지도는 외부 앱이나 브라우저로 이동합니다.</p></div></details></aside></div><footer>예시 게시글의 업체와 활동 수치는 실제 운영 데이터가 아닙니다. 앱·서버·스토어 배포는 아직 진행하지 않았습니다.</footer></main>
<script>const maps={};((exports)=>{${mapCode}})(maps);
const themeToggle=document.getElementById('theme-toggle');themeToggle.addEventListener('click',()=>{const light=themeToggle.getAttribute('aria-pressed')!=='true';themeToggle.setAttribute('aria-pressed',String(light));themeToggle.textContent=light?'어두운 화면 보기':'밝은 화면 보기';document.querySelectorAll('.phone').forEach(p=>p.hidden=p.dataset.theme!==(light?'light':'dark'));});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{const slug=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===slug)));document.querySelectorAll('[data-tag]').forEach(a=>a.hidden=slug!=='all'&&a.dataset.tag!==slug);document.getElementById('filter-status').textContent=slug==='all'?'전체 예시 글 2개':button.textContent+' · '+document.querySelector('.phone:not([hidden])').querySelectorAll('[data-tag]:not([hidden])').length+'개 예시';}));
const input=document.getElementById('map-input'),link=document.getElementById('map-demo'),status=document.getElementById('map-status');input.addEventListener('input',()=>{const url=maps.googleMapsUrl(input.value);link.hidden=!url;if(url)link.href=url;status.textContent=!input.value.trim()?'링크를 입력하지 않으면 지도 버튼이 표시되지 않아요.':url?'아래 링크로 Google 지도를 열 수 있어요.':'Google 지도에서 장소의 공유 링크를 복사해 붙여넣어 주세요.';input.setAttribute('aria-invalid',String(!!input.value.trim()&&!url));});
</script></body></html>`);
console.log(`Rendered current PostCard, map link and loader: ${out}`);
