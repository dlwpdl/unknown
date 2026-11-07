import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { attachAuthorPhotos } from '../src/lib/feed-data.ts';
import { publicWebFetch } from '../src/lib/public-web.ts';

test('the public web skips author photos without holding the feed for retries', async () => {
  const url = 'https://example.supabase.co';
  let calls = 0;
  const client = createClient(url, 'public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: publicWebFetch(url, 'public-key', async () => { calls++; return new Response('[]'); }) },
  });
  const posts = [{ id: 'post', author: { id: 'author' } }];
  const started = Date.now();
  assert.deepEqual(await attachAuthorPhotos(client, posts), posts);
  assert.ok(Date.now() - started < 900, 'retries would wait 1+2+4 seconds');
  assert.equal(calls, 0);
});
