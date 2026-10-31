import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { meetupPartnerLine } from '../src/lib/meetup-partner.ts';
import { setActiveLanguage, tr } from '../src/i18n/index.ts';

const partner = { businessId: 'f97cd7ad-c80b-4f21-aaf5-b422e1bbab45', name: '지모코', benefit: '음료 1잔' };

test('the partner line reads benefit and optional percent, and hides when unset', () => {
  assert.equal(meetupPartnerLine(partner, tr), '제휴 혜택 · 지모코 · 음료 1잔');
  assert.equal(meetupPartnerLine({ ...partner, percent: 10 }, tr), '제휴 혜택 · 지모코 · 음료 1잔 · 10% 할인');
  assert.equal(meetupPartnerLine({ businessId: partner.businessId, name: '지모코', percent: 15 }, tr), '제휴 혜택 · 지모코 · 15% 할인');
  for (const value of [undefined, null, { ...partner, businessId: '' }, { ...partner, name: ' ' }, { businessId: partner.businessId, name: '지모코', benefit: ' ' }])
    assert.equal(meetupPartnerLine(value, tr), null);
  try {
    setActiveLanguage('en');
    assert.equal(meetupPartnerLine({ ...partner, percent: 10 }, tr), 'Partner perk · 지모코 · 음료 1잔 · 10% off');
  } finally { setActiveLanguage('ko'); }
});

function render(props) {
  const source = readFileSync(new URL('../src/components/meetup-partner-line.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
  const calls = [], exports = {};
  const element = (type, elementProps, ...children) => ({ type, props: { ...elementProps, children } });
  const modules = {
    react: { createElement: element },
    'expo-router': { useRouter: () => ({ push: route => calls.push(['push', route]) }) },
    'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { StyleSheet: { create: styles => styles } },
    '@/components/analytics-controls': { Pressable: 'Pressable' },
    '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/constants/design-system': { ControlMetrics: { touch: 44 }, ControlMotion: { pressedOpacity: 0.82 }, IconSize: { inline: 16 }, Typography: { supporting: {} } },
    '@/constants/theme': { Spacing: { one: 4 } },
    '@/hooks/use-language': { useLanguage: () => ({ tr }) },
    '@/hooks/use-theme': { useTheme: () => ({ accent: '#6E4AA2' }) },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => calls.push(['play', kind]) }) },
    '@/lib/meetup-partner': { meetupPartnerLine },
  };
  vm.runInNewContext(output, { exports, React: modules.react, require: name => modules[name] });
  return { tree: exports.MeetupPartnerLine(props), calls };
}

test('the line links to the business profile with feedback and an accessible name', () => {
  assert.equal(render({ partner: undefined }).tree, null, 'unset partner renders nothing');
  const closed = [];
  const { tree, calls } = render({ partner: { ...partner, percent: 10 }, onBeforeNavigate: () => closed.push(true) });
  assert.equal(tree.type, 'Pressable');
  assert.equal(tree.props.accessibilityRole, 'link');
  assert.equal(tree.props.accessibilityLabel, '제휴 혜택 · 지모코 · 음료 1잔 · 10% 할인');
  assert.equal(tree.props.accessibilityHint, '지모코 비즈니스 프로필 보기');
  assert.equal(tree.props.style({ pressed: true }).at(-1).opacity, 0.82);
  tree.props.onPress();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['play', 'selection'], ['push', { pathname: '/company/[id]', params: { id: partner.businessId } }]]);
  assert.deepEqual(closed, [true], 'the detail sheet closes before navigating');
});

test('the meetup card and detail summary render the partner line', () => {
  const card = readFileSync(new URL('../src/components/chilling-event.tsx', import.meta.url), 'utf8');
  const detail = readFileSync(new URL('../src/components/chilling-host-profile.tsx', import.meta.url), 'utf8');
  // Right after the card's own open button closes, so it is a separate control.
  assert.match(card, /<\/Pressable>\s*\{\/\*[^*]*\*\/\}\s*<MeetupPartnerLine partner=\{room\?\.partner\}/);
  assert.match(detail, /<MeetupPartnerLine partner=\{room\.partner\} onBeforeNavigate=\{onClose\} \/>/);
});
