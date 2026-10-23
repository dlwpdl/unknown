// Local visual check: pass the installed Playwright module path and Chrome executable; installs nothing.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { mount, themes, nodes, text } from './meetup-host-tools-ui.test.mjs';
import * as dateHelpers from '../src/lib/chilling-date.ts';
import * as flatHelpers from '../src/lib/flat-control.ts';
import * as designSystem from '../src/constants/design-system.ts';

test('actual source renders at 320/1024 in light/dark KO/EN with usable controls', async () => {
  const require = createRequire(import.meta.url), native = require('react-native-web');
  assert.ok(process.argv[2] && process.argv[3], 'Pass installed Playwright module path and Chrome executable');
  const { chromium } = require(process.argv[2]);
  const directory = join(tmpdir(), 'meetup-host-tools-render');
  mkdirSync(directory, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.argv[3], headless: true });
  const captures = [];
  try {
    for (const language of ['ko', 'en']) for (const [mode, theme] of Object.entries(themes)) {
      const host = mount('meetup-host-tools', 'MeetupHostTools', { postId: 'a1620000-0000-0000-0000-000000000001' }, { language, theme });
      const picker = mount('meetup-template-picker', 'MeetupTemplatePicker', { draft: { title: '산책', body: '함께 걸어요', applicationQuestion: '어떤 길을 좋아하세요?' }, onApply() {} }, { language, theme });
      await host.flush(); await picker.flush();
      nodes(picker.tree).find(node => node.type === 'Pressable' && text(node).includes('질문 모음')).props.onPress();
      await picker.flush();
      const imports = { react: React, 'react/jsx-runtime': jsx, 'react-native': native,
        '@/constants/theme': { Fonts: { mono: 'monospace' } }, '@/constants/design-system': designSystem, '@/hooks/use-theme': { useTheme: () => theme },
        '@/hooks/use-language': { useLanguage: () => ({ language, locale: language === 'ko' ? 'ko-KR' : 'en-CA', tr: value => value }) },
        '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play() {} }) }, '@/lib/chilling-date': dateHelpers,
        '@/lib/flat-control': flatHelpers, '@/lib/behavior-analytics': { behavior() {}, behaviorView() { return ''; }, scrollThresholds() { return []; } },
        '@expo/ui/community/datetime-picker': { DateTimePicker: () => null } };
      function compile(filename) {
        const exports = {}, source = readFileSync(new URL(`../src/components/${filename}.tsx`, import.meta.url), 'utf8');
        vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
          { exports, require: name => { assert.ok(name in imports, `Unexpected import ${name}`); return imports[name]; }, Date, Intl });
        return exports;
      }
      const { ThemedText } = compile('themed-text'); imports['@/components/themed-text'] = { ThemedText };
      imports['@/components/flat-pressable'] = compile('flat-pressable');
      const controls = compile('analytics-controls'); imports['@/components/analytics-controls'] = controls;
      const { ChillingDateInput } = compile('chilling-date-input');
      const components = { View: native.View, TextInput: native.TextInput, ThemedText, Pressable: controls.Pressable, ChillingDateInput, Fragment: React.Fragment };
      function element(node, index) {
        if (typeof node === 'string' || typeof node === 'number') return node;
        if (!node || typeof node !== 'object') return null;
        const { children, ...props } = node.props ?? {};
        assert.ok(components[node.type], `Unknown node ${node.type}`);
        return React.createElement(components[node.type], { ...props, key: index }, ...[children].flat(Infinity).map(element));
      }
      const name = `HostToolsPreview${language}${mode}`;
      native.AppRegistry.registerComponent(name, () => () => React.createElement(native.View, { style: { gap: 24 } }, element(picker.tree), element(host.tree)));
      const app = native.AppRegistry.getApplication(name, {});
      const html = `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${renderToStaticMarkup(app.getStyleElement())}<style>body{margin:0;background:${theme.background};font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:680px;margin:auto;padding:16px;box-sizing:border-box}</style></head><body><main>${renderToStaticMarkup(app.element)}</main></body></html>`;
      const path = join(directory, `${language}-${mode}.html`); writeFileSync(path, html);
      for (const width of [320, 1024]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
        await page.goto(pathToFileURL(path).href); await page.evaluate(() => document.fonts.ready);
        const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth,
          controls: [...document.querySelectorAll('[role="button"],[role="radio"],input')].map(element => ({
            label: element.getAttribute('aria-label') || element.textContent, height: element.getBoundingClientRect().height,
            width: element.getBoundingClientRect().width })) }));
        assert.equal(layout.overflow, false, `${language}/${mode}/${width} horizontal overflow`);
        assert.ok(layout.controls.every(control => control.height >= 44), JSON.stringify(layout));
        const screenshot = join(directory, `${language}-${mode}-${width}.png`);
        await page.screenshot({ path: screenshot, fullPage: true }); await page.close();
        captures.push({ language, mode, width, html: path, screenshot, layout });
      }
    }
    const sourceHashes = Object.fromEntries(['meetup-host-tools', 'meetup-template-picker'].map(filename => [filename,
      createHash('sha256').update(readFileSync(new URL(`../src/components/${filename}.tsx`, import.meta.url))).digest('hex')]));
    const report = join(directory, 'verification.json');
    writeFileSync(report, JSON.stringify({ createdAt: new Date().toISOString(),
      scope: 'Actual TSX hook harness through RN Web and real Gling text, Pressable and date controls; synthetic network; native picker dialog untested',
      sourceHashes, captures }, null, 2));
    console.log(JSON.stringify({ captures: captures.length, reportPath: report }));
  } finally { await browser.close(); }
});
