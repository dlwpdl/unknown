import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(file, imports) {
  const exports = {};
  const source = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(source, { exports, require(name) {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}

const { Colors } = load('constants/theme.ts', { '@/global.css': {}, 'react-native': { Platform: { select: values => values.default } } });
const flatten = styles => Object.assign({}, ...styles.flat(Infinity).filter(Boolean));

function glass(scheme, platform = 'ios', api = true, liquid = true) {
  return load('components/glass-surface.tsx', {
    '@/hooks/use-theme': { useTheme: () => Colors[scheme] },
    '@/constants/theme': { Colors },
    'react-native': { Platform: { OS: platform }, View: 'View', StyleSheet: { hairlineWidth: 0.5, create: styles => styles } },
    'expo-glass-effect': { GlassView: 'GlassView', isGlassEffectAPIAvailable: () => {
      if (api === 'throw') throw new Error('native module unavailable');
      return api;
    }, isLiquidGlassAvailable: () => {
      if (liquid === 'throw') throw new Error('native module unavailable');
      return liquid;
    } },
  }).GlassSurface;
}

test('glass uses the native surface only when iOS offers both required APIs', () => {
  for (const [platform, api, liquid, expected] of [
    ['ios', true, true, 'GlassView'],
    ['ios', true, false, 'View'],
    ['ios', false, true, 'View'],
    ['android', true, true, 'View'],
    ['web', true, true, 'View'],
    ['ios', 'throw', true, 'View'],
    ['ios', true, 'throw', 'View'],
  ]) {
    const GlassSurface = glass('dark', platform, api, liquid);
    assert.equal(GlassSurface({ children: 'content' }).type, expected);
    const control = GlassSurface({ children: 'content', tone: 'control', interactive: true });
    assert.equal(control.type, expected);
    if (expected === 'GlassView') {
      assert.equal(control.props.glassEffectStyle, 'clear');
      assert.equal(control.props.isInteractive, true);
    }
  }
});

test('native glass follows the effective theme and preserves tone, children and style precedence', () => {
  for (const scheme of ['light', 'dark']) {
    const GlassSurface = glass(scheme);
    const overlay = GlassSurface({ children: 'content' });
    assert.equal(overlay.props.colorScheme, scheme);
    assert.equal(overlay.props.tintColor, Colors[scheme].background);
    assert.equal(overlay.props.glassEffectStyle, 'regular');
    assert.equal(overlay.props.isInteractive, false);
    assert.equal(overlay.props.children, 'content');
    assert.equal(flatten(overlay.props.style).borderColor, scheme === 'dark' ? 'rgba(255,255,255,0.4)' : Colors.light.line);
    const control = GlassSurface({ tone: 'control', interactive: true });
    assert.equal(control.props.colorScheme, scheme);
    assert.equal(control.props.tintColor, undefined);
    assert.equal(control.props.glassEffectStyle, 'clear');
    assert.equal(control.props.isInteractive, true);
    assert.equal(flatten(control.props.style).borderWidth, 1);
    assert.equal(flatten(control.props.style).borderColor, scheme === 'dark' ? 'rgba(255,255,255,0.24)' : Colors.light.line);
    const custom = { borderColor: 'red', borderWidth: 3, backgroundColor: 'blue' };
    assert.deepEqual(flatten(GlassSurface({ tone: 'control', style: custom }).props.style), { overflow: 'hidden', ...custom });
  }
});

test('fallback glass pairs light and dark surfaces and keeps caller styles last', () => {
  for (const scheme of ['light', 'dark']) for (const platform of ['ios', 'android', 'web']) {
    const GlassSurface = glass(scheme, platform, false);
    for (const tone of ['overlay', 'control']) {
      const surface = GlassSurface({ tone });
      const style = flatten(surface.props.style);
      assert.equal(surface.type, 'View');
      assert.equal(style.borderColor, scheme === 'light' ? Colors.light.line : tone === 'control' ? 'rgba(255,255,255,0.24)' : 'rgba(255,255,255,0.4)');
      assert.equal(style.backgroundColor, scheme === 'light' ? `${tone === 'control' ? Colors.light.backgroundElement : Colors.light.background}${tone === 'control' ? 'C2' : 'D6'}` : tone === 'control' ? 'rgba(33,33,40,0.76)' : 'rgba(11,11,18,0.84)');
      const custom = { backgroundColor: 'red', borderColor: 'blue' };
      const overridden = flatten(GlassSurface({ tone, style: custom }).props.style);
      assert.equal(overridden.backgroundColor, custom.backgroundColor);
      assert.equal(overridden.borderColor, custom.borderColor);
    }
  }
});

test('explicit media appearance overrides the effective theme on native and fallback surfaces', () => {
  for (const native of [true, false]) for (const scheme of ['light', 'dark']) for (const tone of ['overlay', 'control']) {
    const props = { children: 'fixed foreground', tone, interactive: true };
    const expected = glass(scheme, 'ios', native)(props);
    const actual = glass(scheme === 'dark' ? 'light' : 'dark', 'ios', native)({ ...props, colorScheme: scheme });
    if (native) assert.equal(actual.props.colorScheme, scheme);
    else assert.equal(flatten(actual.props.style).backgroundColor, scheme === 'light' ? `${tone === 'control' ? Colors.light.backgroundElement : Colors.light.background}${tone === 'control' ? 'C2' : 'D6'}` : tone === 'control' ? 'rgba(33,33,40,0.76)' : 'rgba(11,11,18,0.84)');
    assert.equal(JSON.stringify(actual), JSON.stringify(expected));
  }
});

test('media callers retain dark glass around their fixed light foreground', () => {
  for (const [file, count] of [['components/local-events-carousel.tsx', 3], ['app/events/[id].tsx', 2]]) {
    const source = ts.createSourceFile(file, readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let found = 0;
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === 'GlassSurface') {
        found++;
        const scheme = node.attributes.properties.find(prop => prop.name?.getText(source) === 'colorScheme');
        assert.equal(scheme?.initializer?.text, 'dark', `${file}: media overlay must keep dark glass`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    assert.equal(found, count);
  }
});

test('native tabs follow the palette and preserve feedback, badges and Android background', () => {
  for (const scheme of ['light', 'dark']) for (const platform of ['ios', 'android']) {
    const feedback = [];
    const NativeTabs = Object.assign(() => {}, { Trigger: Object.assign(() => {}, { Label: 'Label', Icon: 'Icon', Badge: 'Badge' }) });
    const { default: AppTabs } = load('components/app-tabs.tsx', {
      'expo-router/unstable-native-tabs': { NativeTabs },
      'react-native': { Platform: { OS: platform } },
      '@/constants/theme': { Colors },
      '@/hooks/use-theme': { useTheme: () => Colors[scheme] },
      '@/i18n/ko': { t: { tabs: { today: 'Today', meetups: 'Meetups', write: 'Write', chat: 'Chat', notifications: 'Notifications' } } },
      '@/hooks/use-unread-count': { useUnreadCount: type => type === 'chat' ? 120 : 3 },
      '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
    });
    const { props } = AppTabs();
    const colors = Colors[scheme];
    assert.equal(props.blurEffect, platform === 'ios' ? scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight' : undefined);
    assert.equal(props.backgroundColor, platform === 'ios' ? undefined : colors.background);
    assert.equal(props.iconColor.default, colors.textSecondary);
    assert.equal(props.iconColor.selected, colors.accent);
    assert.equal(props.labelStyle.default.color, colors.textSecondary);
    assert.equal(props.labelStyle.selected.color, colors.accent);
    assert.equal(props.tintColor, colors.accent);
    assert.equal(props.shadowColor, colors.line);
    assert.equal(props.indicatorColor, colors.backgroundElement);
    assert.equal(props.disableTransparentOnScrollEdge, true);
    for (const name of ['compose', 'chat']) props.screenListeners({ route: { name } }).tabPress();
    assert.deepEqual(feedback, ['reaction', 'selection']);
    assert.deepEqual(Array.from(props.children, child => child.props.name), ['index', 'meetups', 'compose', 'chat', 'notifications']);
    assert.equal(props.children[3].props.children[2].props.children, '99+');
    assert.equal(props.children[4].props.children[2].props.children, '3');
  }
});
