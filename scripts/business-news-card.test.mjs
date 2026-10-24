import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
function card({ fontScale = 1 } = {}) {
  const slots = [], feedback = [], scopes = []; let cursor = 0;
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; } },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'expo-image': { Image: 'Image' }, 'expo-symbols': { SymbolView: 'SymbolView' },
    'react-native': { View: 'View', StyleSheet: { create: value => value, hairlineWidth: 1 }, useWindowDimensions: () => ({ fontScale }) },
    '@/components/analytics-controls': { Pressable: 'Pressable' }, '@/components/themed-text': { ThemedText: 'ThemedText' },
    '@/components/post-ad-label': { PostAdLabel: 'PostAdLabel' }, '@/components/content-translation': { TranslationControl: 'TranslationControl' },
    '@/constants/design-system': { Typography: { body: { fontSize: 15, lineHeight: 22 }, supporting: {} }, ControlMotion: { pressedOpacity: .82 } },
    '@/constants/theme': { Spacing: { one: 4, two: 8, three: 16 } }, '@/hooks/use-theme': { useTheme: () => ({ line: '#343443', backgroundElement: '#222231' }) },
    '@/hooks/use-language': { useLanguage: () => ({ tr: (text, ...args) => args.reduce((s, a, i) => s.replace(`{${i}}`, String(a)), text), locale: 'ko-KR' }) },
    '@/hooks/use-content-translation': { useContentTranslation: (_kind, _id, source) => ({ display: source }) },
    '@/lib/translation-source': { visibleTranslationSource: (_kind, title, body) => ({ title, body }) },
    '@/lib/auth': { useAuth: () => ({ isAuthed: true, me: { id: 'viewer' } }) },
    '@/lib/feed-data': { getPostImageSource: (post, scope) => { scopes.push(scope); return post.imageUris?.[0] ? { uri: post.imageUris[0] } : undefined; }, relativeTime: () => '1시간 전' },
    '@/lib/interaction-feedback': { useInteractionFeedback: () => ({ play: kind => feedback.push(kind) }) },
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/components/business-news-card.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; } });
  return { render(props) { cursor = 0; return exports.BusinessNewsCard(props); }, feedback, scopes };
}
const post = { id: 'post', author: { id: 'author', nickname: '이웃' }, title: '세로 사진이 있는 비즈니스 소식', body: '기존 상세에서 읽을 본문', createdAt: '2026-10-23', comments: 2, views: 10, hashtags: ['광고'], imageUris: ['https://example.invalid/photo.jpg'] };
test('business news opens the original post and author separately and keeps the ad label', () => {
  const app = card(); let opened = 0, author = 0;
  const tree = app.render({ post, onPress: () => opened++, onAuthor: () => author++ });
  const all = nodes(tree);
  all.find(n => n.props?.analyticsId === 'business.news.post').props.onPress();
  all.find(n => n.props?.analyticsId === 'business.news.author').props.onPress();
  assert.equal(opened, 1); assert.equal(author, 1);
  assert.deepEqual(app.feedback, ['selection', 'selection']);
  assert.equal(all.filter(n => n.type === 'PostAdLabel').length, 1);
  assert.ok(!all.some(n => n.props?.children === post.body), 'body remains available through the existing detail');
  assert.ok(app.scopes.every(scope => scope === 'viewer'));
});
test('thumbnail stays fixed and falls back after error without hiding the post', () => {
  const app = card(), props = { post, onPress() {}, onAuthor() {} };
  let tree = app.render(props), image = nodes(tree).find(n => n.type === 'Image');
  const style = Object.assign({}, ...[image.props.style].flat().filter(Boolean));
  assert.equal(style.width, 72); assert.equal(style.height, 72);
  assert.equal(image.props.contentFit, 'cover');
  image.props.onError(); tree = app.render(props);
  assert.ok(!nodes(tree).some(n => n.type === 'Image'));
  assert.ok(nodes(tree).some(n => n.props?.analyticsId === 'business.news.post'));
});
test('large text can wrap fully and business identity does not replace a general author incorrectly', () => {
  const app = card({ fontScale: 1.6 });
  const tree = app.render({ post: { ...post, business: { id: 'business', name: '실제 비즈니스' } }, onPress() {}, onAuthor() {} });
  const title = nodes(tree).find(n => n.props?.children === post.title);
  assert.equal(title.props.numberOfLines, undefined);
  assert.ok(nodes(tree).some(n => n.props?.children === '실제 비즈니스'));
});
