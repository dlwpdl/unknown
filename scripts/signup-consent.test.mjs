import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { t } from '../src/i18n/ko.ts';
import * as personalInfo from '../src/lib/personal-info.ts';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...Object.values(tree).flatMap(v => Array.isArray(v) ? v.flatMap(nodes) : nodes(v))];
function onboarding(existingProfile = null) {
  const state = [], refs = [], calls = [], opened = [], completed = [];
  let cursor = 0, refCursor = 0, fail = false;
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/profile-onboarding.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, process: { env: {} }, require(name) {
    if (name === 'react') return {
      useEffect() {}, useRef(initial) { return refs[refCursor++] ??= { current: initial }; },
      useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial;
        return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
    };
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react-native') return { Platform: { OS: 'web' }, StyleSheet: { create: x => x }, ...Object.fromEntries(['View','Pressable','TextInput','Modal','ScrollView'].map(x => [x,x])) };
    if (name === 'expo-linking') return { openURL: async url => { opened.push(url); } };
    if (name === '@/hooks/use-theme') return { useTheme: () => ({}) };
    if (name === '@/constants/theme') return { Spacing: {} };
    if (name === '@/i18n/ko') return { t };
    if (name === '@/lib/nickname') return { generateNickname: () => '새회원' };
    if (name === '@/lib/mock') return { CITIES: [] };
    if (name === '@/lib/personal-info') return personalInfo;
    if (name === '@/components/personal-info-fields') return { PersonalInfoFields: 'PersonalInfoFields' };
    if (name === '@/lib/supabase') return { supabase: { rpc: async (...args) => { calls.push(args); return { error: fail ? new Error('offline') : null }; } } };
    return {};
  } });
  const render = () => { cursor = refCursor = 0; return exports.ProfileOnboarding({ visible: true, userId: 'member', socialPhoto: null, existingProfile, onComplete: x => completed.push(x) }); };
  const boxes = () => nodes(render()).filter(n => n.props?.accessibilityRole === 'checkbox');
  const save = async () => { nodes(render()).find(n => n.props?.accessibilityState?.busy !== undefined).props.onPress(); for (let i = 0; i < 10; i++) await Promise.resolve(); };
  return { render, boxes, save, calls, opened, completed, setFail: value => { fail = value; } };
}

test('signup requires each mandatory agreement; select all is optional and reversible', async () => {
  const ui = onboarding();
  assert.equal(ui.boxes().length, 5);
  assert.ok(ui.boxes().every(n => n.props.accessibilityState.checked === false));
  await ui.save(); assert.equal(ui.calls.length, 0);
  ui.boxes()[0].props.onPress();
  assert.ok(ui.boxes().every(n => n.props.accessibilityState.checked === true));
  ui.boxes()[4].props.onPress();
  assert.equal(ui.boxes()[0].props.accessibilityState.checked, 'mixed');
  for (let i = 1; i <= 3; i++) {
    ui.boxes()[i].props.onPress(); await ui.save(); assert.equal(ui.calls.length, 0);
    ui.boxes()[i].props.onPress();
  }
  await ui.save();
  assert.equal(ui.calls[0][0], 'create_profile_with_personal_info');
  assert.equal(ui.calls[0][1].p_personal_info_version, null);
  assert.equal(ui.completed.length, 1, 'required only can finish signup');
  ui.boxes()[0].props.onPress(); ui.boxes()[0].props.onPress();
  assert.ok(ui.boxes().every(n => n.props.accessibilityState.checked === false));
});

test('details never check consent, optional information needs its own consent, failed persistence cannot finish', async () => {
  const ui = onboarding();
  for (const link of nodes(ui.render()).filter(n => n.props?.accessibilityRole === 'link')) link.props.onPress();
  assert.deepEqual(ui.opened, ['https://gling.ej-entertainment.com/terms', 'https://gling.ej-entertainment.com/privacy']);
  for (const detail of nodes(ui.render()).filter(n => n.props?.accessibilityState?.expanded === false)) detail.props.onPress();
  assert.ok(ui.boxes().every(n => n.props.accessibilityState.checked === false));
  const fields = nodes(ui.render()).find(n => n.type === 'PersonalInfoFields');
  assert.equal(fields.props.showConsent, false, 'no duplicated optional checkbox');
  fields.props.onChange({ fullName: '테스트', dateOfBirth: '1990-01-01', accepted: false });
  for (let i = 1; i <= 3; i++) ui.boxes()[i].props.onPress();
  await ui.save(); assert.equal(ui.calls.length, 0);
  ui.boxes()[4].props.onPress(); ui.setFail(true);
  await ui.save(); assert.equal(ui.completed.length, 0);
  ui.setFail(false); await ui.save();
  assert.equal(ui.calls.at(-1)[1].p_personal_info_version, personalInfo.PERSONAL_INFO_VERSION);
  assert.equal(ui.completed.length, 1);
  const existing = onboarding({ nickname: '기존회원', city_id: 'vancouver', avatar_path: null, photoUri: null });
  assert.equal(existing.boxes().length, 4);
  existing.boxes()[0].props.onPress(); await existing.save();
  assert.equal(existing.calls[0][0], 'create_profile_with_consent');
});
