import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadPhotoConsentSettings, savePostPhotoConsent, setPhotoConsentDefault } from '../src/lib/post-photo-consent.ts';

const post = 'e5200000-0000-4000-8000-000000000001';
const client = answers => {
  const calls = [];
  return { calls, rpc: async (name, args) => { calls.push([name, args]); const next = answers.shift(); if (next instanceof Error) throw next; return next; } };
};

test('the setting reads strictly, and an older server hides the box instead of failing', async () => {
  const ok = client([{ data: { photoConsentDefault: false, consentedPosts: 2 }, error: null }]);
  assert.deepEqual(await loadPhotoConsentSettings(ok), { on: false, consentedPosts: 2 });
  assert.deepEqual(ok.calls, [['get_photo_consent_default', undefined]]);
  assert.equal(await loadPhotoConsentSettings(client([{ data: null, error: { code: 'PGRST202' } }])), null);
  await assert.rejects(loadPhotoConsentSettings(client([{ data: null, error: { code: '42501', message: 'denied' } }])), { code: '42501' });
  for (const bad of [null, { photoConsentDefault: 'yes', consentedPosts: 0 }, { photoConsentDefault: true, consentedPosts: -1 }, { photoConsentDefault: true, consentedPosts: 1.5 }, { photoConsentDefault: true }])
    await assert.rejects(loadPhotoConsentSettings(client([{ data: bad, error: null }])), /INVALID_PHOTO_CONSENT_RESPONSE/);
});

test('turning the setting off must come back with every earlier yes withdrawn', async () => {
  const off = client([{ data: { photoConsentDefault: false, consentedPosts: 0 }, error: null }]);
  assert.deepEqual(await setPhotoConsentDefault(off, false), { on: false, consentedPosts: 0 });
  assert.deepEqual(off.calls, [['set_photo_consent_default', { p_on: false }]]);
  await assert.rejects(setPhotoConsentDefault(client([{ data: { photoConsentDefault: false, consentedPosts: 1 }, error: null }]), false), /INVALID_PHOTO_CONSENT_RESPONSE/);
  await assert.rejects(setPhotoConsentDefault(client([{ data: { photoConsentDefault: false, consentedPosts: 0 }, error: null }]), true), /INVALID_PHOTO_CONSENT_RESPONSE/);
  assert.deepEqual(await setPhotoConsentDefault(client([{ data: { photoConsentDefault: true, consentedPosts: 3 }, error: null }]), true), { on: true, consentedPosts: 3 });
});

test('saving a post\'s consent tries twice, never throws, and reports whether it stuck', async () => {
  const first = client([{ data: { postId: post, consent: true }, error: null }]);
  assert.equal(await savePostPhotoConsent(first, post), true);
  assert.deepEqual(first.calls, [['set_post_photo_consent', { p_post_id: post, p_consent: true }]]);
  const second = client([new Error('Failed to fetch'), { data: { postId: post, consent: true }, error: null }]);
  assert.equal(await savePostPhotoConsent(second, post), true);
  assert.equal(second.calls.length, 2);
  const never = client([{ data: null, error: { message: 'POST_NOT_FOUND' } }, { data: { consent: false }, error: null }]);
  assert.equal(await savePostPhotoConsent(never, post), false);
  assert.equal(never.calls.length, 2, 'two tries, then the caller tells the member');
});

test('the migration keeps old app calls working and the consent list away from members', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261105010000_post_photo_consent.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, /function public\.create_post/, 'create_post signatures stay as they are for older apps');
  assert.match(sql, /revoke all on private\.post_photo_consent from public,anon,authenticated,service_role/);
  const candidates = sql.slice(sql.indexOf('create function public.get_photo_consent_candidates'));
  assert.match(candidates, /private\.is_active_account\(c\.user_id\) and not private\.is_operated_character\(c\.user_id\)/, 'suspended and operated accounts never count');
  assert.match(candidates, /auth\.role\(\) is distinct from 'service_role' then perform public\.log_admin_access/, 'only the service role or a logged admin reads it');
  assert.doesNotMatch(sql, /get_photo_consent_candidates\(integer\) to [^;]*anon/);
  assert.match(sql, /if not p_on then delete from private\.post_photo_consent where user_id=uid/, 'off withdraws earlier consent');
  for (const id of ['compose.photo-consent', 'profile.settings.photo-consent.on', 'profile.settings.photo-consent.off', 'profile.settings.photo-consent.withdraw'])
    assert.ok(sql.includes(`('${id}')`), id);
});
