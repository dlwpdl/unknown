import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeActions, revenuePeriod, loadImpactRevenue, handleRevenueRequest } from '../supabase/functions/_shared/impact-revenue.ts';

const now = new Date('2026-09-25T06:00:00Z');
const config = { accountSid: 'IRtest123', authToken: 'test-only', campaignIds: ['42'] };
const action = (id, extra = {}) => ({ Id: id, CampaignId: 42, State: 'PENDING', Payout: '0.10', Amount: '999', Currency: 'CAD', EventDate: '2026-09-02T00:00:00Z', ClearedDate: '', ...extra });
const period = revenuePeriod('2026-09', now);

test('only Ticketmaster commission is summed; paid, unpaid, reversals and currencies stay separate', () => {
  const rows = [action('1'), action('2', { Payout: '0.20' }), action('3', { State: 'APPROVED', Payout: '4.50' }),
    action('4', { State: 'APPROVED', ClearedDate: '2026-09-20T00:00:00Z', Payout: '8.123456' }),
    action('5', { State: 'REVERSED', Payout: '20' }), action('6', { Currency: 'USD', Payout: '2' }),
    action('7', { CampaignId: 999, Payout: '700' }), action('8', { EventDate: '2026-08-31T23:59:59Z' })];
  assert.deepEqual(summarizeActions(rows, ['42'], period, now), [
    { currency: 'CAD', pending: '0.3', approved: '4.5', settled: '8.123456' },
    { currency: 'USD', pending: '2', approved: '0', settled: '0' },
  ]);
  assert.deepEqual(summarizeActions([], ['42'], period, now), []);
  for (const extra of [{ Payout: '' }, { Payout: 'NaN' }, { Currency: '' }, { State: 'UNKNOWN' }, { EventDate: 'bad' }, { State: 'APPROVED', ClearedDate: '2027-01-01T00:00:00Z' }]) {
    assert.throws(() => summarizeActions([action('bad', extra)], ['42'], period, now));
  }
});

test('month validation handles year rollover and rejects excessive history and invalid dates', () => {
  assert.equal(revenuePeriod('2025-12', new Date('2026-01-02Z')).start, '2025-12-01T00:00:00.000Z');
  assert.equal(period.end, now.toISOString());
  for (const month of ['2026-13', '2026-9', '2026-06', '2026-10', '../x']) assert.throws(() => revenuePeriod(month, now));
});

test('all pages and updated-date windows are fetched, duplicates are not double counted', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const u = new URL(url); calls.push(u);
    assert.equal(u.origin, 'https://api.impact.com');
    assert.equal(options.headers['IR-Version'], '16');
    assert.equal(u.searchParams.get('CampaignId'), '42');
    assert.ok(Date.parse(u.searchParams.get('EndDate')) - Date.parse(u.searchParams.get('StartDate')) <= 45 * 86400000);
    const p = u.searchParams.get('Page');
    return Response.json({ '@page': p, '@total': '2', '@numpages': '2', Actions: [action(p, { EventDate: '2026-07-02T00:00:00Z' })] });
  };
  const data = await loadImpactRevenue(config, '2026-07', now, fakeFetch);
  assert.ok(calls.length >= 4);
  assert.equal(data.totals[0].pending, '0.2');
  assert.equal(data.generatedAt, now.toISOString());
});

test('provider failures, malformed data and incomplete pagination never become zero income', async () => {
  for (const response of [Response.json({}, { status: 401 }), Response.json({ Actions: [] }), Response.json({ '@numpages': '99', Actions: [] }), Response.json({ '@numpages': '1', Actions: 'bad' })]) {
    await assert.rejects(loadImpactRevenue(config, '2026-09', now, async () => response));
  }
  await assert.rejects(loadImpactRevenue(config, '2026-09', now, async () => Response.json({ '@page': '1', '@total': '2', '@numpages': '2', Actions: [action('same')] })));
  await assert.rejects(loadImpactRevenue(config, '2026-09', now, async (url) => Response.json({ '@page': new URL(url).searchParams.get('Page'), '@total': '2', '@numpages': '2', Actions: [action('same')] })));
});

test('financial data requires verified admin and successful audit before provider calls', async () => {
  let queried = 0, audited = 0;
  const deps = { getUser: async () => ({ app_metadata: { role: 'admin' } }), audit: async () => { audited++; }, load: async () => { queried++; return { connected: true }; } };
  const request = () => new Request('https://example.test', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ month: '2026-09' }) });
  assert.equal((await handleRevenueRequest(request(), { ...deps, getUser: async () => null })).status, 401);
  assert.equal((await handleRevenueRequest(request(), { ...deps, getUser: async () => ({ app_metadata: { role: 'user' } }) })).status, 403);
  assert.equal((await handleRevenueRequest(request(), { ...deps, audit: async () => { throw new Error('audit down'); } })).status, 503);
  assert.equal(queried, 0);
  assert.equal((await handleRevenueRequest(request(), deps)).status, 200);
  assert.equal(audited, 1); assert.equal(queried, 1);
});
