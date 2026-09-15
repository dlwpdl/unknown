import assert from 'node:assert/strict';
import test from 'node:test';

import { getPostImagePlan } from '../src/lib/image-upload.ts';

test('게시글 사진은 긴 변만 1600px로 줄이고 원본 비율을 맡긴다', () => {
  assert.deepEqual(getPostImagePlan(4000, 3000, 'image/jpeg'), {
    resize: { width: 1600 }, format: 'jpeg', mimeType: 'image/jpeg',
  });
  assert.deepEqual(getPostImagePlan(1200, 2400, 'image/jpeg'), {
    resize: { height: 1600 }, format: 'jpeg', mimeType: 'image/jpeg',
  });
});

test('작은 사진은 확대하지 않고 투명 형식은 유지한다', () => {
  assert.deepEqual(getPostImagePlan(1200, 900, 'image/png'), {
    resize: null, format: 'png', mimeType: 'image/png',
  });
  assert.deepEqual(getPostImagePlan(2400, 1200, 'image/webp'), {
    resize: { width: 1600 }, format: 'webp', mimeType: 'image/webp',
  });
});
