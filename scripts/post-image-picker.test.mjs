import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// 압축과 썸네일 생성만 확인한다. 규칙 값은 image-upload.test.mjs가 담당한다.
function load(saves, thumbBytes = 'thumb') {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(new URL('../src/lib/post-image-picker.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const rendered = [];
  const manipulate = () => {
    const resizes = [];
    return {
      resize(value) { resizes.push(value); rendered.push(value); },
      async renderAsync() {
        // 긴 변 480으로 줄이는 호출은 목록용 썸네일이다.
        const isThumb = resizes.some((value) => (value.width ?? value.height) === 480);
        return { width: 1280, height: 720, saveAsync: async () => ({ uri: 'file://optimized.webp', base64: isThumb ? thumbBytes : saves.shift() ?? saves[saves.length - 1] ?? 'small' }) };
      },
    };
  };
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'expo-image-manipulator') return { ImageManipulator: { manipulate }, SaveFormat: { WEBP: 'webp', JPEG: 'jpeg', PNG: 'png' } };
    if (name === 'expo-image-picker') return {};
    if (name === './image-upload.ts') return {
      estimatedBase64Bytes: (value) => Math.ceil(value.length * 0.75),
      FEED_THUMB_DIMENSION: 480,
      getPostImagePlan: (width, height, limit, quality) => {
        const resize = width <= 0 || height <= 0 || Math.max(width, height) <= limit ? null : width >= height ? { width: limit } : { height: limit };
        return { resize, format: 'webp', mimeType: 'image/webp', quality };
      },
      MAX_IMAGE_BYTES: 2 * 1024 * 1024,
      POST_IMAGE_ATTEMPTS: [{ limit: 1280, quality: 0.72 }, { limit: 1024, quality: 0.62 }, { limit: 800, quality: 0.55 }],
      TARGET_IMAGE_BYTES: 700 * 1024,
    };
    throw new Error(`Unexpected import: ${name}`);
  } });
  return { prepare: exports.preparePostImage, rendered, thumbBytes };
}

test('예산 안에 들어오면 첫 시도에서 끝내고 webp로 저장한다', async () => {
  const { prepare, rendered } = load(['a'.repeat(1000)]);
  const prepared = await prepare({ uri: 'file://source.jpg', width: 3200, height: 1800, mimeType: 'image/jpeg' }, { withThumb: true });
  assert.equal(prepared.mimeType, 'image/webp');
  assert.equal(prepared.bytes, 750);
  assert.equal(prepared.thumbBase64, 'thumb');
  assert.deepEqual(rendered, [{ width: 1280 }, { width: 480 }]);
});

test('예산을 넘으면 더 작은 시도로 내려가고, 모두 넘으면 거부한다', async () => {
  const big = 'a'.repeat(Math.ceil(1_000_000 / 0.75));
  const { prepare, rendered } = load([big, big, 'a'.repeat(1000)]);
  const prepared = await prepare({ uri: 'file://source.jpg', width: 3200, height: 1800, mimeType: 'image/jpeg' });
  assert.deepEqual(rendered, [{ width: 1280 }, { width: 1024 }, { width: 800 }]);
  assert.equal(prepared.bytes, 750);

  const huge = 'a'.repeat(Math.ceil(3_000_000 / 0.75));
  const { prepare: reject } = load([huge, huge, huge]);
  await assert.rejects(reject({ uri: 'file://source.jpg', width: 3200, height: 1800, mimeType: 'image/jpeg' }), /IMAGE_TOO_LARGE/);
});
