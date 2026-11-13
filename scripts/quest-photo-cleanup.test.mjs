import assert from 'node:assert/strict';
import test from 'node:test';
import { handleQuestPhotoCleanup } from '../supabase/functions/_shared/quest-photo-cleanup.ts';

const host = '11111111-1111-4111-8111-111111111111';
const photo = { id: '22222222-2222-4222-8222-222222222222', path: `${host}/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp` };
function harness(rows, { removeError = null } = {}) {
  const calls = [];
  const options = {
    secret: 'cleanup-secret',
    rpc: async (name, args) => { calls.push([name, args]); return { error: null, data: name === 'claim_host_quest_photo_cleanup' ? rows : 1 }; },
    remove: async (paths) => { calls.push(['remove', paths]); return { error: removeError }; },
  };
  const run = (secret = 'cleanup-secret', method = 'POST') => handleQuestPhotoCleanup(new Request('https://example.test', { method, headers: { 'x-push-secret': secret } }), options);
  return { calls, run };
}

test('cleanup needs the scheduler secret before claiming anything', async () => {
  const { calls, run } = harness([photo]);
  assert.equal((await run('wrong')).status, 401);
  assert.equal((await run('cleanup-secret', 'GET')).status, 405);
  assert.deepEqual(calls, []);
});

test('cleanup removes due photos and orphan uploads, then marks only photo rows deleted', async () => {
  const orphan = { id: null, path: `${host}/55555555-5555-4555-8555-555555555555.webp` };
  const { calls, run } = harness([photo, orphan, { id: 'x', path: '../other-bucket/file.webp' }]);
  const response = await run();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { deleted: 2 });
  assert.deepEqual(calls[1], ['remove', [photo.path, orphan.path]]);
  assert.deepEqual(calls[2], ['finish_host_quest_photo_cleanup', { p_ids: [photo.id] }]);
});

test('a failed storage delete does not mark photos deleted', async () => {
  const { calls, run } = harness([photo], { removeError: { message: 'boom' } });
  assert.equal((await run()).status, 500);
  assert.equal(calls.some(([name]) => name === 'finish_host_quest_photo_cleanup'), false);
});
