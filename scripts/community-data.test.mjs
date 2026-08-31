import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostImagePath, deleteMyAccount } from '../src/lib/community-data.ts';

test('게시글 이미지는 사용자 폴더와 MIME 확장자를 사용한다', () => {
  assert.equal(
    buildPostImagePath('user-1', 'image/jpeg', 1234),
    'user-1/1234.jpg',
  );
  assert.equal(
    buildPostImagePath('user-1', 'image/png', 1234),
    'user-1/1234.png',
  );
});

test('Storage가 허용하지 않는 이미지 형식은 업로드 전에 거부한다', () => {
  assert.throws(() => buildPostImagePath('user-1', 'image/gif', 1234), /UNSUPPORTED_IMAGE_TYPE/);
});

test('탈퇴 처리 전에 사용자 Storage 폴더를 비운다', async () => {
  const calls = [];
  const listed = new Set();
  const client = {
    rpc: async (name, input) => {
      calls.push(`rpc:${name}:${input.p_confirmation}`);
      return { data: null, error: null };
    },
    storage: {
      from: (bucket) => ({
        list: async (folder) => {
          calls.push(`list:${bucket}:${folder}`);
          if (listed.has(bucket)) return { data: [], error: null };
          listed.add(bucket);
          return { data: bucket === 'avatars' ? [{ name: 'avatar.jpg' }] : [{ name: 'one.jpg' }, { name: 'two.png' }], error: null };
        },
        remove: async (paths) => {
          calls.push(`remove:${bucket}:${paths.join(',')}`);
          return { data: null, error: null };
        },
      }),
    },
  };

  await deleteMyAccount(client, 'user-1');

  assert.deepEqual(calls, [
    'list:avatars:user-1',
    'remove:avatars:user-1/avatar.jpg',
    'list:avatars:user-1',
    'list:post-images:user-1',
    'remove:post-images:user-1/one.jpg,user-1/two.png',
    'list:post-images:user-1',
    'rpc:delete_my_account:탈퇴합니다',
  ]);
});
