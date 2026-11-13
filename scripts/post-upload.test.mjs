import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canRetryUpload, clearPostUpload, finishDelay, getPostUpload, retryPostUpload, savedByEarlierTry,
  startPostUpload, subscribePostUpload, uploadBarSteps, UploadMotion,
} from '../src/lib/post-upload.ts';

const settle = () => new Promise(setImmediate);
function job(sends) {
  const calls = [];
  return { calls, owner: 'me', title: '국물이 진해요', photoCount: 3, photos: [{ uri: 'a', from: { x: 1, y: 2, width: 100, height: 100 } }, { uri: 'b' }],
    send: retry => { calls.push(retry); const next = sends.shift(); return typeof next === 'function' ? next() : next ?? Promise.resolve(); } };
}
test.afterEach(() => clearPostUpload());

test('the bar never fills before the server answers, then finishes from where it is', () => {
  const steps = uploadBarSteps('uploading');
  assert.deepEqual(steps.map(step => step.to), [0.7, 0.9]);
  assert.deepEqual(steps.map(step => step.ms), [700, 1000], 'fast to 70%, slower to 90% (mockup values)');
  assert.ok(steps.every(step => step.to < 1));
  assert.deepEqual(uploadBarSteps('done'), [{ to: 1, ms: 240, curve: 'out' }]);
  assert.deepEqual(uploadBarSteps('failed'), [], 'a failed bar stays where it stopped');
  assert.equal(finishDelay(100), UploadMotion.landMs - 100, 'a fast answer waits for the photos to land');
  assert.equal(finishDelay(5000), 0);
  assert.equal(finishDelay(-20), UploadMotion.landMs, 'a clock jump does not shorten the wait');
});

test('only one post uploads at a time and the card shows it without the send function', async () => {
  let release;
  const first = job([new Promise(resolve => { release = resolve; })]);
  const seen = [];
  const stop = subscribePostUpload(() => seen.push(getPostUpload()?.status ?? null));
  assert.equal(startPostUpload(first, 1000), true);
  assert.equal(getPostUpload().status, 'uploading');
  assert.equal(getPostUpload().send, undefined);
  assert.equal(getPostUpload().photos[0].from.width, 100);
  assert.equal(startPostUpload(job([]), 1001), false, 'a second post waits for the first');
  clearPostUpload();
  assert.equal(getPostUpload().status, 'uploading', 'an in-flight upload cannot be dropped');
  release(); await settle();
  assert.equal(getPostUpload().status, 'done');
  assert.deepEqual(first.calls, [false]);
  const key = getPostUpload().key;
  assert.equal(startPostUpload(job([]), 2000), true, 'a finished card does not block the next post');
  assert.notEqual(getPostUpload().key, key);
  clearPostUpload(key);
  assert.ok(getPostUpload(), 'an old card timer cannot clear a newer upload');
  await settle();
  stop();
  assert.deepEqual(seen, ['uploading', 'done', 'uploading', 'done']);
});

test('a failure keeps the post and its photos, and retry sends the same job once', async () => {
  const offline = Object.assign(new Error('Failed to fetch'), { code: '' });
  let release;
  const failing = job([Promise.reject(offline), () => new Promise(resolve => { release = resolve; })]);
  startPostUpload(failing, 1000); await settle();
  const failed = getPostUpload();
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, offline);
  assert.equal(failed.title, '국물이 진해요');
  assert.equal(failed.photoCount, 3);
  assert.equal(canRetryUpload(failed.error), true);
  assert.equal(retryPostUpload(5000), true);
  assert.equal(retryPostUpload(5001), false, 'a double tap does not send twice');
  assert.equal(getPostUpload().status, 'uploading');
  assert.equal(getPostUpload().key, failed.key, 'the same card keeps going');
  assert.equal(getPostUpload().startedAt, 5000);
  assert.equal(getPostUpload().photos[0].from, undefined, 'photos already sit in the card, so they do not fly again');
  assert.deepEqual(failing.calls, [false, true], 'the retry is marked so an earlier save can be recognised');
  release(); await settle();
  assert.equal(getPostUpload().status, 'done');
  assert.equal(retryPostUpload(), false, 'a finished post cannot be sent again');
});

test('a retry the server calls a duplicate story was saved by the earlier try; other refusals stay editable', async () => {
  assert.equal(savedByEarlierTry(new Error('DUPLICATE_POST'), true), true);
  assert.equal(savedByEarlierTry(new Error('DUPLICATE_POST'), false), false, 'on the first try it is a real repeat the writer must see');
  assert.equal(savedByEarlierTry(new Error('DUPLICATE_LISTING'), true), false, 'a same-title listing may be a different, older one');
  assert.equal(savedByEarlierTry(new Error('Failed to fetch'), true), false);
  for (const message of ['CONTENT_NOT_ALLOWED', 'LISTING_LIMIT_REACHED', 'DUPLICATE_POST']) {
    assert.equal(canRetryUpload(new Error(message)), false, message);
  }
  startPostUpload(job([Promise.reject(new Error('CONTENT_NOT_ALLOWED'))])); await settle();
  assert.equal(getPostUpload().status, 'failed');
  assert.equal(retryPostUpload(), false, 'sending blocked words again cannot help; only editing can');
  clearPostUpload();
  assert.equal(getPostUpload(), null);
});

test('a post that is up but missed a follow-up save finishes done and carries one quiet line', async () => {
  startPostUpload(job([Promise.resolve({ notice: 'SNS에 소개해도 된다는 체크만 저장이 안 됐어요' })])); await settle();
  assert.equal(getPostUpload().status, 'done', 'the post itself is up, so this is not a failure');
  assert.equal(getPostUpload().notice, 'SNS에 소개해도 된다는 체크만 저장이 안 됐어요');
  clearPostUpload();
  startPostUpload(job([Promise.resolve()])); await settle();
  assert.equal(getPostUpload().notice, undefined, 'a normal post shows its title as before');
  assert.equal(getPostUpload().first, undefined, 'and keeps the card-only finish');
  clearPostUpload();
  startPostUpload(job([Promise.resolve({ first: true })])); await settle();
  assert.equal(getPostUpload().first, true, 'the first post asks the card for the full celebration');
});

test('a post from the place writer keeps its own 수정하기, through a retry too (QA B10-2)', async () => {
  const edits = [];
  const failing = { ...job([() => Promise.reject(new Error('offline')), () => Promise.reject(new Error('offline'))]), edit: () => edits.push('place writer') };
  startPostUpload(failing, 1000); await settle();
  assert.equal(getPostUpload().status, 'failed');
  retryPostUpload(1100); await settle();
  assert.equal(getPostUpload().status, 'failed');
  getPostUpload().edit();
  assert.deepEqual(edits, ['place writer'], 'the card reopens the writer that holds the draft');
  clearPostUpload();
  startPostUpload(job([() => Promise.reject(new Error('offline'))]), 2000); await settle();
  assert.equal(getPostUpload().edit, undefined, 'the 오늘 writer leaves it empty, so the card goes to compose=1 as before');
});
