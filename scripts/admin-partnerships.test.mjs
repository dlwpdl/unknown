import assert from 'node:assert/strict';
import test from 'node:test';
import * as partnerships from '../src/lib/admin-partnerships.ts';

test('creator identity comparison preserves metrics across UTF8 links and respects case-sensitive channel paths', () => {
  const profiles = partnerships.creatorProfiles({ profile_url: 'https://example.com/あ', platforms: [{ platform: '웹사이트', url: 'https://example.com/%e3%81%82', followers: '12.3K', checked_on: null }] });
  assert.equal(profiles.length, 1); assert.equal(profiles[0].followers, '12.3K');
  assert.equal(partnerships.creatorProfiles({ profile_url: 'https://youtube.com/ChannelId', platforms: [{ platform: 'YouTube', url: 'https://youtube.com/channelid', followers: '', checked_on: null }] }).length, 2);
});
import { amountToCents, loadPartnerships, savePartnership, issueBenefitCoupon, actBenefitCoupon, partnershipError } from '../src/lib/admin-partnerships.ts';

const id = '70000000-0000-4000-8000-000000000001';
const other = '70000000-0000-4000-8000-000000000002';
const revision = '2026-10-15T18:00:00.123456Z';
const row = { id, display_name: '밴쿠버 식탁', updated_at: revision };
const page = { kind: 'creators', rows: [row], record: null, participations: [], coupons: [], events: [], more: false, children_more: false };

test('support amounts convert decimal strings to integer cents without rounding or exponent parsing', () => {
  for (const [input, expected] of [['', null], ['  ', null], ['150', 15000], ['150.50', 15050], ['0.01', 1], ['0', 0], ['999999.99', 99999999]]) assert.equal(amountToCents(input), expected);
  for (const input of ['-1', '1e3', '1.001', '1000000', 'NaN', '1,500', 'Infinity']) assert.throws(() => amountToCents(input), /INVALID_PARTNERSHIP/);
});

test('bounded list/detail reads retain the selected record, exact search and independent child page', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ...page, record: row }, error: null }; } };
  const data = await loadPartnerships(client, 'creators', ' 밴쿠버 ', 50, id, 100);
  assert.equal(data.record.id, id);
  assert.deepEqual(calls, [{ name: 'get_admin_partnerships', args: { p_kind: 'creators', p_search: '밴쿠버', p_offset: 50, p_id: id, p_child_offset: 100 } }]);
});

test('malformed or mismatched protected readbacks cannot become visible records', async () => {
  for (const data of [null, { ...page, kind: 'benefits' }, { ...page, rows: null }, { ...page, more: 'false' }, { ...page, rows: [{ ...row, id: '' }] }, { ...page, rows: Array(51).fill(row) }, { ...page, record: { ...row, id: other } }]) {
    await assert.rejects(loadPartnerships({ rpc: async () => ({ data, error: null }) }, 'creators', '', 0, id), /PARTNERSHIP_READ_FAILED/);
  }
});

test('creation and stale-edit protection pass exact stable IDs and database timestamps without retry', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: id, error: null }; } };
  const record = { id, display_name: '밴쿠버 식탁' };
  await savePartnership(client, 'creator', record, null);
  await savePartnership(client, 'creator', record, revision);
  assert.equal(calls[0].args.p_expected_updated_at, null);
  assert.equal(calls[1].args.p_expected_updated_at, revision, 'microseconds must survive JavaScript');
  assert.deepEqual(calls[1].args.p_record, record);
  let count = 0;
  await assert.rejects(savePartnership({ rpc: async () => { count++; return { data: null, error: { message: 'PARTNERSHIP_CHANGED' } }; } }, 'creator', record, revision), /PARTNERSHIP_CHANGED/);
  assert.equal(count, 1);
  await assert.rejects(savePartnership({ rpc: async () => ({ data: other, error: null }) }, 'creator', record, revision), /PARTNERSHIP_SAVE_UNVERIFIED/);
});

test('coupon issuance fixes one recipient and one request ID; actions preserve revision and confirmation note', async () => {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: id, error: null }; } };
  await issueBenefitCoupon(client, id, other, { creator_id: id, user_id: null });
  assert.deepEqual(calls[0], { name: 'issue_admin_benefit_coupon', args: { p_id: id, p_benefit_id: other, p_creator_id: id, p_user_id: null } });
  await actBenefitCoupon(client, id, revision, 'redeem', ' 현장 확인 ');
  assert.equal(calls[1].args.p_expected_updated_at, revision);
  assert.equal(calls[1].args.p_note, '현장 확인');
  const before = calls.length;
  await assert.rejects(issueBenefitCoupon(client, id, other, { creator_id: id, user_id: other }), /INVALID_PARTNERSHIP/);
  await assert.rejects(actBenefitCoupon(client, id, revision, 'redeem', ' '), /INVALID_PARTNERSHIP/);
  assert.equal(calls.length, before, 'invalid recipient/confirmation never reaches the server');
});

test('errors explain operator actions without leaking raw server text or promising a successful write', () => {
  assert.match(partnershipError(new Error('PARTNERSHIP_CHANGED')), /다른|최신/);
  assert.match(partnershipError(new Error('PARTNERSHIP_CAPACITY')), /정원|한도/);
  assert.match(partnershipError(new Error('PARTNERSHIP_TERMS_REQUIRED')), /조건/);
  const text = partnershipError(new Error('private.sql_detail access token=secret'));
  assert.doesNotMatch(text, /private|token|secret/);
  assert.match(text, /확인|다시/);
});

test('creator profiles keep the representative link first and retain observed audience labels', () => {
  const creator = { profile_url: 'https://www.instagram.com/local/', platforms: [
    { platform: 'YouTube', url: 'https://youtube.com/@local', followers: '', checked_on: null },
    { platform: 'Instagram', url: 'https://www.instagram.com/local/', followers: '1.4만', checked_on: '2026-10-15' },
  ] };
  const result = partnerships.creatorProfiles(creator);
  assert.equal(result[0].platform, 'Instagram');
  assert.equal(result[0].followers, '1.4만');
  assert.equal(result[0].checked_on, '2026-10-15');
  assert.equal(result[1].url, 'https://youtube.com/@local');
  assert.equal(partnerships.creatorProfiles({ profile_url: 'https://www.instagram.com/legacy/' })[0].followers, '');
  assert.equal(partnerships.creatorProfiles({ profile_url: 'javascript:alert(1)' }).length, 0);
});
