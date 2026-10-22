import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildInventory } from './festival-content-inventory.mjs';

test('count only current open-city supply, separating evidence and reserved content', () => {
  const cities = [{ id: 'vancouver', state: 'open' }, { id: 'toronto', state: 'open' }, { id: 'ottawa', state: 'soon' }];
  const policy = { daily_bundles: 4, buffer_days: 7, minimum_new_bundles_per_city: 2, research_days: 90, minimum_research_through: '2026-12-31' };
  const ready = key => ({ key, city: 'vancouver', fact_check_status: 'passed-within-stated-scope', native_draft_eligible: true,
    current_draft: { city: 'vancouver', start_date: '2026-10-01', end_date: '2026-10-02', eligibility: { local_caption_verified: true, local_media_ready: true, gling_registration_eligible: true } }, channels: {} });
  const registered = ready('registered');
  registered.channels = { gling: { status: 'published', native_id: 'post', receipt: 'post.json' }, instagram: { status: 'published', native_id: 'ig', receipt: 'ig.json' }, youtube: { status: 'scheduled', native_id: 'yt', receipt: 'yt.json' }, tiktok: { status: 'local-draft-brand-login-held' } };
  const expired = ready('expired'); expired.current_draft.end_date = '2026-09-30'; expired.current_draft.start_date = '2026-09-29';
  const invalid = ready('invalid'); invalid.current_draft.end_date = '2026-02-30';
  const unknownRegistration = ready('unknown-registration'); unknownRegistration.current_draft.gling_registered = true;
  const missingPublicationProof = ready('missing-proof'); missingPublicationProof.channels.gling = { status: 'published', native_id: 'unconfirmed' };
  const conflict = ready('conflict'); const changedConflict = structuredClone(conflict); changedConflict.fact_check_status = 'held';
  const prepared = ready('prepared');
  const distant = ready('distant'); distant.current_draft.start_date = '2027-02-01'; distant.current_draft.end_date = '2027-02-02';
  const events = [prepared, structuredClone(prepared), registered, expired, invalid, unknownRegistration, missingPublicationProof,
    conflict, changedConflict, distant, { key: 'research', city: 'vancouver' }, { ...ready('closed-city'), city: 'ottawa' }];
  // Vancouver is still Oct 1 while Toronto has reached Oct 2.
  const report = buildInventory(events, { cities, policy, now: new Date('2026-10-02T04:30:00Z') });
  assert.equal(report.cities[0].local_day, '2026-10-01');
  assert.equal(report.cities[1].local_day, '2026-10-02');
  assert.equal(report.research_through, '2026-12-31');
  assert.equal(report.cities.length, 2);
  assert.equal(report.totals.prepared_new_gling, 1);
  assert.equal(report.totals.registered_gling, 1);
  assert.equal(report.totals.registration_unconfirmed, 2);
  assert.equal(report.totals.held, 3);
  assert.equal(report.totals.expired, 1);
  assert.equal(report.totals.outside_window, 1);
  assert.equal(report.channels.instagram.published, 1);
  assert.equal(report.channels.instagram.prepared_unassigned, 0);
  assert.equal(report.channels.youtube.scheduled, 1);
  assert.equal(report.channels.youtube.prepared_unassigned, 0);
  assert.equal(report.channels.tiktok.prepared_unassigned, 1);
  const missingChannel = structuredClone(registered); delete missingChannel.channels.tiktok;
  assert.equal(buildInventory([missingChannel], { cities, policy, now: new Date('2026-10-02T04:30:00Z') }).channels.tiktok.preparation_unconfirmed, 1);
  assert.equal(report.refill.new_bundles_needed, 27);
  assert.equal(report.refill.city_priority[0].city, 'toronto');
  assert.equal(buildInventory([], { cities, policy, now: new Date('2026-10-02T04:30:00Z') }).refill.new_bundles_needed, 28);
  assert.equal(buildInventory([], { cities, policy, now: new Date('2027-02-01T18:00:00Z') }).research_through, '2027-05-02');
  assert.equal(buildInventory([{ ...ready('new-city'), city: 'halifax' }], {
    cities: [{ id: 'halifax', state: 'open' }], policy, now: new Date('2026-10-02T04:30:00Z')
  }).held[0].reasons.includes('missing-city-timezone'), true);
});

test('verified places replenish supply without fake event dates, keeping closed or uncertain places held', () => {
  const cities = [{ id: 'vancouver', state: 'open' }];
  const policy = { daily_bundles: 4, buffer_days: 7, minimum_new_bundles_per_city: 2, research_days: 90, minimum_research_through: '2026-12-31' };
  const place = { key: 'place:vancouver:test-address', city: 'vancouver', content_kind: 'place',
    fact_check_status: 'passed-within-stated-scope', native_draft_eligible: true,
    current_draft: { city: 'vancouver', content_kind: 'place', name: 'Test-only library',
      place_type: 'library', place_address: 'Test-only address', place_operating_status: 'open',
      place_verified_on: '2026-10-07', eligibility: { local_caption_verified: true, local_media_ready: true, gling_registration_eligible: true } }, channels: {} };
  const closed = structuredClone(place); closed.key = 'closed'; closed.current_draft.place_operating_status = 'closed';
  const unknown = structuredClone(place); unknown.key = 'unknown'; delete unknown.current_draft.place_address;
  const future = structuredClone(place); future.key = 'future'; future.current_draft.place_verified_on = '2026-10-08';
  const fakeEvent = structuredClone(place); fakeEvent.key = 'fake-event'; fakeEvent.current_draft.start_date = '2026-10-07';
  const report = buildInventory([place, closed, unknown, future, fakeEvent], { cities, policy, now: new Date('2026-10-07T20:00:00Z') });
  assert.equal(report.totals.prepared_new_gling, 1);
  assert.equal(report.totals.expired, 0);
  assert.equal(report.totals.held, 4);
  assert.equal(report.refill.new_bundles_needed, 27);
  assert.equal(report.channels.instagram.prepared_unassigned, 0, 'Gling-first proof still applies to places');
  for (const item of report.held) assert.ok(item.reasons.includes('unverified-place-details'));
});
