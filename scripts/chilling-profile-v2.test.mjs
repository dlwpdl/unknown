import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChillingProfile, chillingProfilePreview, loadChillingProfile, loadChillingApplication, requestChillingJoin } from '../src/lib/chilling-data.ts';

const owner = '00000000-0000-4000-8000-000000000001';
const profile = {
  version: 2, displayName: ' 산책친구 ', cityId: 'vancouver', photoPaths: [`${owner}/one.webp`, `${owner}/two.webp`], publicPhotoPath: `${owner}/two.webp`,
  intro: ' 주말을 함께 ', interests: [' 산책 '], promptOne: '카페에서 수다', promptTwo: '편하게 이야기해요', promptOneId: 'meet', promptTwoId: 'join', shareWithMembers: false,
  preferences: { activities: [' 독서 '], availability: ' 토요일 오후 ', pace: 'relaxed' },
};

test('v2 save keeps the independent identity and owner preferences but removes untrusted extra fields', () => {
  const clean = normalizeChillingProfile({ ...profile, nickname: 'public', photoUris: ['secret-data-uri'], ownerId: 'forged' });
  assert.equal(clean.version, 2);
  assert.equal(clean.displayName, '산책친구');
  assert.deepEqual(clean.photoPaths, profile.photoPaths);
  assert.deepEqual(clean.preferences, { activities: ['독서'], availability: '토요일 오후', pace: 'relaxed' });
  assert.equal(clean.photoUris, undefined);
  assert.equal(clean.nickname, undefined);
  assert.equal(clean.ownerId, undefined);
});

test('malformed identities, prompt IDs and non-owner media formats are not accepted', () => {
  for (const patch of [{ displayName: '' }, { displayName: '가'.repeat(31) }, { cityId: '../unknown' }, { photoPaths: [`${owner}/../one.webp`] }, { photoPaths: [...profile.photoPaths, ...profile.photoPaths] }, { publicPhotoPath: `${owner}/not-selected.webp` }, { promptOneId: 'invented' }, { shareWithMembers: 'yes' }, { preferences: { ...profile.preferences, pace: 'party' } }]) {
    assert.throws(() => normalizeChillingProfile({ ...profile, ...patch }), /INVALID_CHILLING_PROFILE/);
  }
});

test('each audience preview excludes private preferences and discloses only selected photos', () => {
  const photos = { ...profile, photoUris: ['data:first', 'data:public'] };
  const host = chillingProfilePreview(photos, 'host');
  assert.equal(host.preferences, undefined);
  assert.equal(host.promptOne, profile.promptOne);
  assert.deepEqual(host.photoUris, ['data:first', 'data:public']);
  const publicHost = chillingProfilePreview(photos, 'public');
  assert.deepEqual(publicHost.photoPaths, [profile.publicPhotoPath]);
  assert.deepEqual(publicHost.photoUris, ['data:public']);
  assert.equal(publicHost.promptOne, '', 'public host introductions do not publish application prompts');
  assert.equal(publicHost.promptTwo, '');
  const privateMember = chillingProfilePreview(photos, 'members');
  assert.equal(privateMember.intro, '');
  assert.deepEqual(privateMember.photoPaths, []);
  assert.equal(privateMember.cityId, undefined, 'the name-only member preview does not disclose a city');
  const member = chillingProfilePreview({ ...photos, shareWithMembers: true }, 'members');
  assert.equal(member.intro, profile.intro);
  assert.equal(member.promptOne, '');
  assert.equal(member.promptTwo, '');
  assert.equal(member.preferences, undefined);
});

test('new sharing requires every selected photo to preview, while editing and optional roster images can recover', async () => {
  const client = { rpc: async () => ({ data: { ...profile, revision: 'r1' }, error: null }), storage: { from: () => ({ download: async () => ({ data: null, error: new Error('offline') }) }) } };
  const editable = await loadChillingProfile(client);
  assert.deepEqual(editable.photoUris, [null, null], 'owner can still remove or replace an unavailable image');
  await assert.rejects(loadChillingProfile(client, 'application'), /CHILLING_PROFILE_PHOTOS_UNAVAILABLE/);
  await assert.rejects(loadChillingProfile(client, 'hosting'), /CHILLING_PROFILE_PHOTOS_UNAVAILABLE/);
  client.rpc = async () => ({ data: { ...profile, publicPhotoPath: null, revision: 'r1' }, error: null });
  assert.equal((await loadChillingProfile(client, 'hosting')).publicPhotoPath, null, 'private photos do not block a host who shares no public photo');
});

test('application metadata never fetches the community profile, even for a legacy application', async () => {
  let selection = '';
  const query = { select(value) { selection = value; return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: 'request', status: 'pending', host_id: 'host', requester_id: owner, post: { title: '산책' } }, error: null }; } };
  const client = { rpc: async () => ({ data: { requesterId: owner, profile: { intro: '소개', interests: ['산책'], promptOne: '답', promptTwo: '답' } }, error: null }), from: () => query };
  const application = await loadChillingApplication(client, 'request', owner);
  assert.doesNotMatch(selection, /profiles|avatar_path|nickname|city_id/);
  assert.equal(application.request.requester.nickname, '모임 멤버');
  assert.equal(application.request.requester.avatar_path, null);
});

test('new application consent is bound to the displayed server revision', async () => {
  let writes = 0;
  const client = { rpc: async (name, args) => { writes++; assert.equal(name, 'request_chilling_join_v2'); assert.equal(args.p_profile_revision, 'opaque-server-revision'); assert.equal(args.p_profile, undefined); return { data: null, error: new Error('CHILLING_PROFILE_CHANGED') }; } };
  await assert.rejects(requestChillingJoin(client, 'post', '같이 걸어요', true, ''), /CHILLING_PROFILE_CHANGED/);
  assert.equal(writes, 0);
  await assert.rejects(requestChillingJoin(client, 'post', '같이 걸어요', true, 'opaque-server-revision'), /CHILLING_PROFILE_CHANGED/);
  assert.equal(writes, 1);
  assert.equal(normalizeChillingProfile({ ...profile, revision: 'opaque-server-revision' }).revision, undefined);
});
