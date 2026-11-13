import assert from 'node:assert/strict';
import test from 'node:test';
import { jobPostingSkip, publicJobPosting } from '../src/lib/public-job-posting.ts';
import { loadPublicPosts, renderPublicPost } from './prerender-public-posts.mjs';
import { PUBLIC_SITE } from '../src/lib/public-seo.ts';

const now = Date.parse('2026-11-12T12:00:00Z');
const id = '11111111-1111-4111-8111-111111111111', businessId = '22222222-2222-4222-8222-222222222222';
const text = ['구인 · 키친 스태프 · 시급 $21 · 코퀴틀람 · 파트타임', '하는 일: 재료 준비와 정리', '· 급여: 경력에 따라 시급 $21~25 + 팁', '· 조건: 영어로 소통할 수 있어야 해요.'].join('\n');
const job = { id, title: '코퀴틀람 지모코 키친 스태프 구해요, 시급 $21~$25', preview: text, previewFull: true, createdAt: '2026-11-10T18:00:00Z',
  author: 'Jimoco Cafe & Pasta', tagSlug: 'jobs', businessId, businessAddress: '1046A Austin Ave, Coquitlam, BC V3K 3P3, Canada',
  listingStatus: 'open', expiresAt: '2026-11-24T18:00:00Z' };

test('a live business job post with its whole text and a business address becomes a JobPosting of that visible text', () => {
  const node = publicJobPosting(job, now);
  assert.equal(node.title, '키친 스태프', 'the job only, without business name or wage');
  assert.equal(node.description, text);
  assert.equal(node.datePosted, '2026-11-10T18:00:00.000Z'); assert.equal(node.validThrough, '2026-11-24T18:00:00.000Z');
  assert.deepEqual(node.hiringOrganization, { '@type': 'Organization', name: 'Jimoco Cafe & Pasta', sameAs: `${PUBLIC_SITE}/company/${businessId}` });
  assert.deepEqual(node.jobLocation.address, { '@type': 'PostalAddress', streetAddress: '1046A Austin Ave', addressLocality: 'Coquitlam',
    addressRegion: 'BC', postalCode: 'V3K 3P3', addressCountry: 'CA' });
  assert.deepEqual(node.employmentType, ['PART_TIME']);
  assert.deepEqual(node.baseSalary, { '@type': 'MonetaryAmount', currency: 'CAD', value: { '@type': 'QuantitativeValue', minValue: 21, maxValue: 25, unitText: 'HOUR' } });
  const multi = publicJobPosting({ ...job, businessAddress: '77 Finch Ave W, Suite 202, North York, ON M2N 2H5' }, now).jobLocation.address;
  assert.equal(multi.streetAddress, '77 Finch Ave W, Suite 202'); assert.equal(multi.addressLocality, 'North York'); assert.equal(multi.addressRegion, 'ON');
});

test('wage and employment type appear only when the text states them plainly', () => {
  const wage = line => publicJobPosting({ ...job, preview: text.replace('· 급여: 경력에 따라 시급 $21~25 + 팁', line) }, now).baseSalary?.value;
  assert.deepEqual(wage('· 급여: 시급 $17.95 + 팁 + 베케이션 페이'), { '@type': 'QuantitativeValue', value: 17.95, unitText: 'HOUR' });
  assert.deepEqual(wage('· 급여: 시급 $18부터(경력에 따라 협의) + 팁'), { '@type': 'QuantitativeValue', minValue: 18, unitText: 'HOUR' });
  assert.deepEqual(wage('· 급여: 시급 $18.25 이상, 경력에 따라 협의'), { '@type': 'QuantitativeValue', minValue: 18.25, unitText: 'HOUR' });
  for (const line of ['· 급여: 미니멈 + 팁', '· 급여: 경력에 따라 협의', '· 급여: $18.50~$20', '· 급여: 양식 경력 1년 이상 $21, 2년 $22', '· 급여: 시급 $21, 3년 차는 $23'])
    assert.equal(wage(line), undefined, line);
  const plain = publicJobPosting({ ...job, preview: text.replace(' · 파트타임', '') }, now);
  assert.equal(plain.employmentType, undefined);
});

test('filled, expired, cut, address-less and non-business job posts carry no JobPosting', () => {
  const cases = {
    'not-business-job': [{ businessId: null }, { tagSlug: 'housing' }],
    'not-full': [{ previewFull: false }, { previewFull: undefined }, { preview: '' }],
    'no-expiry': [{ listingStatus: null, expiresAt: null }],
    closed: [{ listingStatus: 'closed' }],
    expired: [{ expiresAt: '2026-11-12T11:59:59Z' }, { expiresAt: null }],
    'missing-fields': [{ preview: text.replace('구인 · 키친 스태프 · ', '') }, { author: ' ' }],
    'no-address': [{ businessAddress: '' }, { businessAddress: 'Toronto & GTA' }, { businessAddress: '230-3700 North Fraser Way, Burnaby, BC V5J 5H4 (Grand Central Realty)' }],
  };
  for (const [reason, changes] of Object.entries(cases)) for (const change of changes) {
    assert.equal(jobPostingSkip({ ...job, ...change }, now), reason, JSON.stringify(change));
    assert.equal(publicJobPosting({ ...job, ...change }, now), null);
  }
  assert.equal(jobPostingSkip({ ...job, listingStatus: 'partial' }, now), null);
});

test('the prerendered page adds the JobPosting as its own @graph node next to the post, and only business job posts read a business profile', async () => {
  const shell = '<html><head></head><body><div id="root">app</div></body></html>';
  const page = renderPublicPost(shell, { ...job, cityId: 'vancouver', city: '밴쿠버', label: '구인구직', expiresAt: '2099-01-01T00:00:00Z' });
  const graph = JSON.parse(page.match(/<script type="application\/ld\+json">([^<]*)<\/script>/)[1])['@graph'];
  assert.deepEqual(graph.map(node => node['@type']), ['DiscussionForumPosting', 'BreadcrumbList', 'JobPosting']);
  assert.equal(graph[2].description, graph[0].text, 'the posting text is the text on the page');
  assert.ok(!renderPublicPost(shell, { ...job, previewFull: false }).includes('JobPosting'));

  const story = '33333333-3333-4333-8333-333333333333', calls = [];
  const fetcher = async (url, init) => {
    const name = url.split('/rpc/')[1], args = JSON.parse(init.body);
    calls.push(name);
    const data = name === 'get_search_excluded_post_ids' ? []
      : name === 'get_public_feed_page_v2' ? [{ id, tag_slug: 'jobs', listing_status: 'open', expires_at: job.expiresAt, created_at: job.createdAt, author_nickname: job.author },
        { id: story, tag_slug: 'life', created_at: job.createdAt }]
      : name === 'get_public_post_businesses' ? [{ post_id: id, business_id: businessId }, { post_id: story, business_id: businessId }]
      : name === 'get_merchant_profile' ? { id: args.p_merchant_id, address: job.businessAddress }
      : { id: args.p_post_id, kind: 'post', title: 't', preview: text, previewFull: true };
    return { ok: true, json: async () => data };
  };
  const { posts } = await loadPublicPosts({ url: 'https://db.example', key: 'anon', cities: ['vancouver'], searchToken: 't', fetcher });
  const loaded = posts.find(post => post.id === id), other = posts.find(post => post.id === story);
  assert.equal(loaded.businessAddress, job.businessAddress); assert.equal(loaded.listingStatus, 'open'); assert.equal(loaded.businessId, businessId);
  assert.equal(other.businessAddress, null);
  assert.equal(calls.filter(name => name === 'get_merchant_profile').length, 1);
  assert.ok(publicJobPosting(loaded, now));
});
