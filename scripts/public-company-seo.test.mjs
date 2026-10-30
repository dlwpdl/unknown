import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finishPublicWeb } from './finish-public-web.mjs';
import { prerenderPublicCompanies } from './prerender-public-companies.mjs';
import { PUBLIC_SITE } from '../src/lib/public-seo.ts';

const rated = '11111111-1111-4111-8111-111111111111', plain = '22222222-2222-4222-8222-222222222222';
const logo = `business-profile/${rated}/avatar/${'a'.repeat(32)}`;
const profiles = {
  [rated]: { id: rated, name: '지모코 <카페>', city_id: 'vancouver', city_name: '밴쿠버', industry: '음식점', services: '파스타와 커피', address: '123 Main St',
    avatar_path: logo, banner_path: null, review_post_id: '33333333-3333-4333-8333-333333333333', public_phone: '604-000-0000', business_hours: '월–금 09:00–18:00',
    source_urls: ['https://www.instagram.com/jimoco/', 'javascript:alert(1)'] },
  [plain]: { id: plain, name: '보라 펭귄', city_id: 'toronto', city_name: '토론토', industry: '카페', services: '', address: '', avatar_path: null, banner_path: null,
    review_post_id: null, public_phone: '', business_hours: '', source_urls: [] },
};
const ld = page => JSON.parse(page.match(/<script type="application\/ld\+json" data-rh="true">([\s\S]*?)<\/script>/)[1]);

test('each public business gets its own indexable page with LocalBusiness data and a sitemap entry', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'gling-seo-companies-'));
  const calls = [];
  const fetcher = async (url, init) => {
    const name = url.split('/rpc/')[1], args = JSON.parse(init.body);
    calls.push([name, init.headers.apikey]);
    const data = name === 'get_public_business_directory'
      ? { items: args.p_city_id === 'vancouver' ? [{ id: rated }] : args.p_city_id === 'toronto' ? [{ id: plain }, { id: 'not-a-uuid' }] : [], has_more: false, next_offset: 0 }
      : name === 'get_merchant_profile' ? profiles[args.p_merchant_id] ?? null
      : { rating_average: '8.66', review_count: 3 };
    return { ok: true, json: async () => data };
  };
  try {
    writeFileSync(join(directory, '+not-found.html'), '<html><head><title data-rh="true">old</title><meta name="robots" content="noindex, nofollow" data-rh="true"/></head><body><div id="root">app</div></body></html>');
    const companies = await prerenderPublicCompanies(directory, { url: 'https://db.example', key: 'anon', cities: ['vancouver', 'toronto', 'montreal'], fetcher });
    assert.deepEqual(companies.map(company => company.id), [rated, plain]);
    assert.ok(calls.every(([, key]) => key === 'anon'));

    const page = readFileSync(join(directory, 'company', `${rated}.html`), 'utf8');
    assert.ok(!page.includes('noindex') && !page.includes('>old<') && page.includes('<div id="root">app</div>'));
    assert.ok(page.includes(`<link rel="canonical" href="${PUBLIC_SITE}/company/${rated}"`));
    assert.ok(page.includes('id="gling-static-company"') && page.includes('지모코 &#60;카페&#62;') && !page.includes('<카페>'));
    const schema = ld(page);
    assert.equal(schema['@type'], 'LocalBusiness');
    assert.equal(schema.url, `${PUBLIC_SITE}/company/${rated}`);
    assert.equal(schema.name, '지모코 <카페>');
    assert.equal(schema.telephone, '604-000-0000');
    assert.equal(schema.openingHours, '월–금 09:00–18:00');
    assert.equal(schema.address.streetAddress, '123 Main St');
    assert.deepEqual(schema.sameAs, ['https://www.instagram.com/jimoco/']);
    assert.deepEqual(schema.aggregateRating, { '@type': 'AggregateRating', ratingValue: 8.7, bestRating: 10, worstRating: 1, reviewCount: 3 });
    assert.match(page, /property="og:image" content="[^"]*format=business-image[^"]*kind=avatar/);

    const bare = ld(readFileSync(join(directory, 'company', `${plain}.html`), 'utf8'));
    assert.equal(bare.aggregateRating, undefined, 'no rating without verified reviews');
    assert.equal(bare.telephone, undefined);
    assert.deepEqual(bare.areaServed, { '@type': 'City', name: '토론토' });
    assert.match(readFileSync(join(directory, 'company', `${plain}.html`), 'utf8'), /og:image" content="https:\/\/gling\.ej-entertainment\.com\/share-covers\/business\.png"/);

    finishPublicWeb(directory, [], companies);
    const sitemap = readFileSync(join(directory, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes(`<loc>${PUBLIC_SITE}/company/${rated}</loc>`) && sitemap.includes(`<loc>${PUBLIC_SITE}/business</loc>`));
  } finally { rmSync(directory, { recursive: true }); }
});
