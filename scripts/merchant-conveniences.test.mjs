import assert from 'node:assert/strict';
import test from 'node:test';
import { loadMerchantProfile } from '../src/lib/merchant-profile.ts';

const api = await import('../src/lib/merchant-conveniences.ts').catch(() => ({}));
const merchant = '14510000-0000-4000-8000-000000000001';
const conversation = '14520000-0000-4000-8000-000000000001';
const profile = { id: merchant, name: '등록된 비즈니스', city_id: 'vancouver', city_name: '밴쿠버', industry: '카페', services: '커피', address: '123 Main St, Vancouver, BC', avatar_path: null, banner_path: null, review_post_id: null,
  public_phone: '+1 (604) 555-0100', business_hours: '월–금 9:00–18:00', can_message: true, saved: true };
const client = data => ({ calls: [], async rpc(name, args) { this.calls.push([name, args]); return { data, error: null }; } });

test('merchant inquiry resolves a real server conversation UUID and rejects unusable navigation results', async () => {
  assert.equal(typeof api.startMerchantConversation, 'function');
  const db = client(conversation);
  assert.equal(await api.startMerchantConversation(db, merchant), conversation);
  assert.deepEqual(db.calls, [['start_business_conversation', { p_as_business_id: null, p_other_user_id: null, p_other_business_id: merchant, p_post_id: null }]]);
  for (const data of [null, '../author', { id: conversation }]) await assert.rejects(api.startMerchantConversation(client(data), merchant), /BUSINESS_CHAT_READ_FAILED/);
  await assert.rejects(api.startMerchantConversation(db, '../author'), /INVALID_MERCHANT/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(api.startMerchantConversation({ rpc: async () => ({ error: { message: 'MERCHANT_CONTACT_UNAVAILABLE' } }) }, merchant), /MERCHANT_CONTACT_UNAVAILABLE/);
});

test('save changes accept only the requested server boolean and do not invent a successful save', async () => {
  assert.equal(typeof api.setSavedMerchant, 'function');
  const db = client(true);
  assert.equal(await api.setSavedMerchant(db, merchant, true), true);
  assert.deepEqual(db.calls, [['set_saved_merchant', { p_merchant_id: merchant, p_saved: true }]]);
  assert.equal(await api.setSavedMerchant(client(false), merchant, false), false);
  for (const data of [null, false, 'true']) await assert.rejects(api.setSavedMerchant(client(data), merchant, true), /MERCHANT_SAVE_NOT_VERIFIED/);
  await assert.rejects(api.setSavedMerchant(db, merchant, 'true'), /INVALID_MERCHANT_SAVE/);
  await assert.rejects(api.setSavedMerchant({ rpc: async () => ({ error: { message: 'offline' } }) }, merchant, false), /offline/);
});

test('public phone links emit a fixed tel scheme while rejecting other actions, extensions and malformed numbers', () => {
  assert.equal(typeof api.merchantPhoneUrl, 'function');
  for (const [value, expected] of [['+1 (604) 555-0100', 'tel:+16045550100'], ['604.555.0100', 'tel:6045550100'], ['02-123-4567', 'tel:021234567']]) assert.equal(api.merchantPhoneUrl(value), expected);
  for (const value of ['', '  ', 'tel:6045550100', 'https://shop.test', '+16045550100?x=1', '6045550100#1', '6045550100;ext=4', '6045550100\n', '12', '+1234567890123456', '604＋5550100']) assert.equal(api.merchantPhoneUrl(value), null);
});

test('public profile DTO defaults new fields safely and never includes private owner/contact fields', async () => {
  const loaded = await loadMerchantProfile(client({ ...profile, owner_id: 'PRIVATE_OWNER', contact: 'PRIVATE_CONTACT', public_phone: null, business_hours: null, can_message: 'yes', saved: 'yes' }), merchant);
  assert.equal(loaded.public_phone, ''); assert.equal(loaded.business_hours, '');
  assert.equal(loaded.can_message, false); assert.equal(loaded.saved, false);
  assert.ok(!JSON.stringify(loaded).includes('PRIVATE_'));
});

test('saved businesses preserve the server offset, registered information and safe public source links', async () => {
  assert.equal(typeof api.loadSavedMerchants, 'function');
  const db = client({ merchants: [{ ...profile, owner_id: 'PRIVATE_OWNER', source_urls: ['https://shop.example.com/#about', 'javascript:alert(1)'] }], has_more: true });
  const loaded = await api.loadSavedMerchants(db, 20);
  assert.deepEqual(db.calls, [['get_saved_merchants', { p_offset: 20 }]]);
  assert.equal(loaded.nextOffset, 21); assert.equal(loaded.has_more, true);
  assert.equal(loaded.merchants[0].public_phone, profile.public_phone);
  assert.deepEqual(loaded.merchants[0].links, [{ url: 'https://shop.example.com/', label: 'shop.example.com' }]);
  assert.ok(!JSON.stringify(loaded).includes('PRIVATE_'));
  assert.equal((await api.loadSavedMerchants(client({ merchants: [], has_more: true }))).has_more, false);
  for (const offset of [-1, 0.5, 10001]) await assert.rejects(api.loadSavedMerchants(db, offset), /INVALID_MERCHANT_PAGE/);
  for (const data of [null, { merchants: null, has_more: false }, { merchants: [null], has_more: false }, { merchants: [{ ...profile, id: '../private' }], has_more: false }, { merchants: [profile], has_more: 'yes' }]) await assert.rejects(api.loadSavedMerchants(client(data)), /MERCHANT_SAVED_READ_FAILED/);
});

test('contact writes carry the revision, verify exact saved values and preserve rejected edits', async () => {
  assert.equal(typeof api.saveMerchantContact, 'function');
  const updated = '2026-10-09T18:00:00Z';
  const db = client({ ...profile, updated_at: '2026-10-09T18:01:00Z', can_edit: true, contact: 'PRIVATE_CONTACT' });
  const saved = await api.saveMerchantContact(db, merchant, ` ${profile.public_phone} `, profile.business_hours, updated);
  assert.deepEqual(db.calls, [['save_merchant_contact', { p_merchant_id: merchant, p_public_phone: profile.public_phone, p_business_hours: profile.business_hours, p_expected_updated_at: updated }]]);
  assert.equal(saved.public_phone, profile.public_phone); assert.equal(saved.can_edit, true);
  assert.ok(!JSON.stringify(saved).includes('PRIVATE_'));
  for (const data of [null, { ...profile, updated_at: updated, can_edit: true, public_phone: 'other' }, { ...profile, updated_at: updated }]) await assert.rejects(api.saveMerchantContact(client(data), merchant, profile.public_phone, profile.business_hours, updated), /MERCHANT_CONTACT_SAVE_NOT_VERIFIED/);
  for (const [phone, hours, revision] of [['javascript:alert(1)', '', updated], ['', 'x'.repeat(501), updated], ['', '', '']]) await assert.rejects(api.saveMerchantContact(db, merchant, phone, hours, revision), /INVALID_MERCHANT_CONTACT/);
  assert.equal(db.calls.length, 1);
  await assert.rejects(api.saveMerchantContact({ rpc: async () => ({ error: { message: 'MERCHANT_PROFILE_CHANGED' } }) }, merchant, '', '', updated), /MERCHANT_PROFILE_CHANGED/);
});

 test('saved-business opt-in requires a valid boolean and exact server readback', async () => {
  assert.equal(typeof api.setSavedMerchantNotifications, 'function');
  const db = client(true);
  assert.equal(await api.setSavedMerchantNotifications(db, merchant, true), true);
  assert.deepEqual(db.calls, [['set_saved_merchant_notifications', { p_merchant_id: merchant, p_enabled: true }]]);
  assert.equal(await api.setSavedMerchantNotifications(client(false), merchant, false), false);
  for (const data of [false, null, 'true']) await assert.rejects(api.setSavedMerchantNotifications(client(data), merchant, true), /MERCHANT_NOTIFICATIONS_NOT_VERIFIED/);
  await assert.rejects(api.setSavedMerchantNotifications(db, '../private', true), /INVALID_MERCHANT_NOTIFICATIONS/);
  await assert.rejects(api.setSavedMerchantNotifications(db, merchant, 'true'), /INVALID_MERCHANT_NOTIFICATIONS/);
  await assert.rejects(api.setSavedMerchantNotifications({ rpc: async () => ({ error: { message: 'NOT_SAVED' } }) }, merchant, true), /NOT_SAVED/);
  assert.equal((await loadMerchantProfile(client(profile), merchant)).notifications_enabled, false);
  assert.equal((await loadMerchantProfile(client({ ...profile, notifications_enabled: true }), merchant)).notifications_enabled, true);
 });
