import { withLanguageImports } from './test-language-imports.mjs';
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
  vm.runInNewContext(source, { exports, require: withLanguageImports((name) => {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    throw new Error(`Unexpected import: ${name}`);
  }) });
  return exports;
}

const { Colors } = load('constants/theme.ts', { '@/global.css': {}, 'react-native': { Platform: { select: values => values.default } } });
const flatten = styles => Object.assign({}, ...styles.flat(Infinity).filter(Boolean));

test('destructive text meets AA contrast on light, dark and admin surfaces', () => {
  const luminance = color => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  for (const [scheme, palette] of Object.entries(Colors)) {
    assert.ok(palette.danger, `${scheme} requires a destructive text color`);
    for (const background of ['card', 'background', 'backgroundSelected']) {
      const values = [luminance(palette.danger), luminance(palette[background])].sort((a, b) => b - a);
      assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, `${scheme} destructive text must remain readable on ${background}`);
    }
  }
});

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
    assert.equal(control.type, 'View', 'controls remain flat even when native glass is available');
    assert.equal(control.props.glassEffectStyle, undefined);
    assert.equal(flatten(control.props.style).shadowOpacity, 0);
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
    assert.equal(control.type, 'View');
    assert.equal(control.props.tintColor, undefined);
    assert.equal(control.props.glassEffectStyle, undefined);
    assert.equal(flatten(control.props.style).backgroundColor, Colors[scheme].backgroundElement);
    assert.equal(flatten(control.props.style).borderWidth, 1);
    assert.equal(flatten(control.props.style).borderColor, Colors[scheme].line);
    const custom = { borderColor: 'red', borderWidth: 3, backgroundColor: 'blue' };
    assert.deepEqual(flatten(GlassSurface({ tone: 'control', style: custom }).props.style), { overflow: 'hidden', ...custom, shadowOpacity: 0, elevation: 0, boxShadow: undefined });
  }
});

test('fallback surfaces preserve light/dark palette and caller geometry while controls stay flat', () => {
  for (const scheme of ['light', 'dark']) for (const platform of ['ios', 'android', 'web']) {
    const GlassSurface = glass(scheme, platform, false);
    for (const tone of ['overlay', 'control']) {
      const surface = GlassSurface({ tone });
      const style = flatten(surface.props.style);
      assert.equal(surface.type, 'View');
      assert.equal(style.borderColor, tone === 'control' ? Colors[scheme].line : scheme === 'light' ? Colors.light.line : 'rgba(255,255,255,0.4)');
      assert.equal(style.backgroundColor, tone === 'control' ? Colors[scheme].backgroundElement : scheme === 'light' ? `${Colors.light.background}D6` : 'rgba(11,11,18,0.84)');
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
    if (native && tone === 'overlay') assert.equal(actual.props.colorScheme, scheme);
    else assert.equal(flatten(actual.props.style).backgroundColor, tone === 'control' ? Colors[scheme].backgroundElement : scheme === 'light' ? `${Colors.light.background}D6` : 'rgba(11,11,18,0.84)');
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
