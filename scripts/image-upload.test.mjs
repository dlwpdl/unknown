import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEED_THUMB_DIMENSION,
  MAX_IMAGE_BYTES,
  MAX_POST_IMAGES,
  MAX_UPLOAD_DIMENSION,
  POST_IMAGE_ATTEMPTS,
  canAddPostImage,
  estimatedBase64Bytes,
  getPostImagePlan,
  imageMedia,
  isThumbPath,
  mediaKindForPath,
  thumbPathFor,
} from '../src/lib/image-upload.ts';

test('게시글 사진은 긴 변을 1280px로 줄이고 항상 webp로 저장한다', () => {
  assert.deepEqual(getPostImagePlan(4000, 3000), {
    resize: { width: 1280 }, format: 'webp', mimeType: 'image/webp', quality: 0.72,
  });
  assert.deepEqual(getPostImagePlan(1200, 2400), {
    resize: { height: 1280 }, format: 'webp', mimeType: 'image/webp', quality: 0.72,
  });
});

test('작은 사진은 확대하지 않고, 예산을 넘으면 더 작은 시도로 내려간다', () => {
  assert.deepEqual(getPostImagePlan(1200, 900), {
    resize: null, format: 'webp', mimeType: 'image/webp', quality: 0.72,
  });
  assert.deepEqual(POST_IMAGE_ATTEMPTS.map(({ limit, quality }) => [limit, quality]), [[1280, 0.72], [1024, 0.62], [800, 0.55]]);
  assert.deepEqual(getPostImagePlan(2400, 1200, POST_IMAGE_ATTEMPTS[2].limit, POST_IMAGE_ATTEMPTS[2].quality), {
    resize: { width: 800 }, format: 'webp', mimeType: 'image/webp', quality: 0.55,
  });
});

test('썸네일 경로와 용량 계산, 게시물당 10장 상한을 한 곳에서 관리한다', () => {
  assert.equal(thumbPathFor('user/171234.webp'), `user/171234.thumb.webp`);
  assert.equal(thumbPathFor('user/171234'), 'user/171234.thumb.webp');
  assert.equal(isThumbPath('user/1.thumb.webp'), true);
  assert.equal(isThumbPath('user/1.webp'), false);
  assert.equal(mediaKindForPath('user/1.webp'), 'image');
  assert.equal(mediaKindForPath('user/clip.mp4'), 'video');
  assert.deepEqual(imageMedia('user/1.webp', { width: 1280, height: 960, bytes: 500_000 }), {
    kind: 'image', path: 'user/1.webp', thumbPath: 'user/1.thumb.webp', width: 1280, height: 960, bytes: 500_000,
  });
  assert.equal(estimatedBase64Bytes('a'.repeat(4000)), 3000);
  assert.equal(FEED_THUMB_DIMENSION < MAX_UPLOAD_DIMENSION, true);
  assert.equal(MAX_IMAGE_BYTES, 2 * 1024 * 1024);
  assert.equal(MAX_POST_IMAGES, 10);
  assert.equal(canAddPostImage(4), true);
  assert.equal(canAddPostImage(5), true);
  assert.equal(canAddPostImage(9), true);
  assert.equal(canAddPostImage(10), false);
  assert.equal(canAddPostImage(11), false);
});
