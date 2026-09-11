// Static visual harness: production card, ThemedText, theme and RN Web layout.
// Native text scaling is approximated by scaling Text fontSize/lineHeight only.
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
let textScale = 1;
function localRequire(name) {
  if (name.endsWith('.css')) return {};
  if (name === 'react-native') return { ...native, Text(props) {
    const style = native.StyleSheet.flatten(props.style) ?? {};
    return React.createElement(native.Text, { ...props, style: [style, { fontSize: (style.fontSize ?? 14) * textScale, lineHeight: (style.lineHeight ?? 20) * textScale }] });
  } };
  if (name === 'expo-symbols') return { SymbolView({ name, size = 24, tintColor }) {
    return React.createElement(native.Text, { style: { width: size, height: size, fontSize: size, lineHeight: size, fontFamily: 'MaterialSymbols_400Regular', color: tintColor } }, String.fromCharCode(symbols[name.web]));
  } };
  if (!name.startsWith('@/')) return require(name);
  const base = path.join(root, 'src', name.slice(2));
  const filename = ['.web.ts', '.tsx', '.ts'].map(ext => base + ext).find(fs.existsSync);
  if (cache.has(filename)) return cache.get(filename);
  const exports = {};
  cache.set(filename, exports);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: localRequire }, { filename });
  return exports;
}
const { RelationshipSlotCard } = localRequire('@/components/relationship-slot-card');
const { ThemeOverrideProvider } = localRequire('@/hooks/use-theme');
const snapshot = (limit, active, locked, tier) => ({ tier, meetupsUsed: active, meetupSlotsLocked: locked, meetupSlotsAvailable: Math.max(0, limit - active - locked), meetupLimit: limit, meetupUnlocksAt: locked ? ['2026-09-11T20:30:00-07:00'] : [] });
const states = [['베이직 · 3자리', snapshot(3, 1, 1, 'free')], ['플러스 · 5자리', snapshot(5, 2, 1, 'plus')], ['프리미엄 · 10자리', snapshot(10, 4, 2, 'premium')], ['빈자리 없음', snapshot(3, 2, 1, 'free')], ['확인 중', null], ['정보 확인 필요', null], ['한도 변경', snapshot(3, 5, 1, 'free')]];
for (const [filename, scheme, scale] of [['index.html', 'light', 1], ['dark.html', 'dark', 1], ['large.html', 'light', 2]]) {
  textScale = scale;
  const cards = states.map(([label, membership], i) => `<section data-case="${i}"><h2>${label}</h2>${renderToStaticMarkup(React.createElement(ThemeOverrideProvider, { scheme }, React.createElement(RelationshipSlotCard, { kind: 'meetup', membership, loading: i === 4, onMembershipPress: i === 0 ? () => {} : undefined })))}</section>`).join('');
  const css = native.StyleSheet.getSheet().textContent;
  fs.writeFileSync(path.join(out, filename), `<!doctype html><html lang="ko"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gling — 자리 카드 검증</title><style>${css}</style><style>@font-face{font-family:MaterialSymbols_400Regular;src:url(symbols.ttf)}body{margin:0;background:${scheme === 'dark' ? '#15181C' : '#FAF9F5'};color:${scheme === 'dark' ? '#EAE9E2' : '#21252C'};font-family:system-ui}main{padding:16px;max-width:560px;margin:auto}h1{font-size:20px}h2{font-size:13px;font-weight:500;margin:24px 0 8px}a{color:inherit}nav{display:flex;gap:16px;flex-wrap:wrap}p{font-size:13px} :root{--font-display:system-ui}</style><main><h1>글링 · 자리 카드</h1><p>실제 컴포넌트 · ${scheme} · 글자 ${scale * 100}%</p><nav><a href="index.html">기본</a><a href="dark.html">다크</a><a href="large.html">큰 글자</a></nav>${cards}</main></html>`);
}
fs.copyFileSync(path.join(root, 'node_modules/@expo-google-fonts/material-symbols/400Regular/MaterialSymbols_400Regular.ttf'), path.join(out, 'symbols.ttf'));
console.log(`Rendered actual slot card fixtures: ${out}`);
