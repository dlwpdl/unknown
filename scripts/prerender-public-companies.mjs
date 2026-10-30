import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { businessMediaUrl } from '../src/lib/business-media.ts';
import { jsonLd, publicCompanyUrl, publicSiteName, PUBLIC_SITE } from '../src/lib/public-seo.ts';
import { safeMerchantSourceUrl } from '../src/lib/merchant-source.ts';
import { escapeHtml, rpc, withStaticPage } from './prerender-public-posts.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Same public RPCs the guest business directory and /company profile read, with the publishable key only.
export async function loadPublicCompanies({ url, key, cities, fetcher = fetch }) {
  const ids = [];
  for (const city of cities) {
    for (let offset = 0; offset <= 10000;) {
      const page = await rpc(url, key, 'get_public_business_directory', { p_city_id: city, p_query: '', p_industry: null, p_offset: offset }, fetcher);
      for (const row of page.items ?? []) if (UUID.test(row.id) && !ids.includes(row.id)) ids.push(row.id);
      if (!page.has_more) break;
      offset = page.next_offset;
    }
  }
  const companies = [], queue = [...ids];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const profile = await rpc(url, key, 'get_merchant_profile', { p_merchant_id: id }, fetcher);
      if (profile?.id !== id || typeof profile.name !== 'string' || !profile.name.trim()) continue;
      // Only receipt-verified usage reviews count, the same rating the public profile shows.
      const reviews = profile.review_post_id ? await rpc(url, key, 'get_merchant_reviews', { p_post_id: profile.review_post_id, p_offset: 0 }, fetcher) : null;
      companies.push({ ...profile, reviewCount: Number(reviews?.review_count) || 0, ratingAverage: Number(reviews?.rating_average) || null });
    }
  }));
  return companies.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
}

export function renderPublicCompany(template, company) {
  const url = publicCompanyUrl(company.id), title = `${company.name} | ${company.city_name} 한인 비즈니스 · 글링`;
  const intro = String(company.services ?? '').trim();
  const description = [`${company.city_name} · ${company.industry}`, intro.slice(0, 140) || '글링 비즈니스 프로필에서 소식과 영수증 인증 후기를 확인하세요.'].join('. ');
  const logo = company.avatar_path && businessMediaUrl(company.avatar_path), banner = company.banner_path && businessMediaUrl(company.banner_path);
  const image = banner || logo || `${PUBLIC_SITE}/share-covers/business.png`;
  const sameAs = [...new Set((company.source_urls ?? []).map(value => typeof value === 'string' ? safeMerchantSourceUrl(value) : null).filter(Boolean))];
  const schema = {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', '@id': `${url}#business`, url, name: company.name, description: intro || undefined,
    ...(logo || banner ? { image: [banner, logo].filter(Boolean) } : {}), ...(logo ? { logo } : {}),
    ...(company.address ? { address: { '@type': 'PostalAddress', streetAddress: company.address, addressCountry: 'CA' } } : { areaServed: { '@type': 'City', name: company.city_name } }),
    ...(company.public_phone ? { telephone: company.public_phone } : {}),
    // Hours are free text the owner types; schema.org accepts a human-readable openingHours string.
    ...(company.business_hours ? { openingHours: company.business_hours } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    ...(company.reviewCount > 0 && company.ratingAverage ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: Math.round(company.ratingAverage * 10) / 10, bestRating: 10, worstRating: 1, reviewCount: company.reviewCount } } : {}),
    isPartOf: { '@type': 'WebSite', name: publicSiteName(), url: `${PUBLIC_SITE}/` },
  };
  const head = [
    `<title data-rh="true">${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}" data-rh="true"/>`,
    '<meta name="robots" content="index, follow, max-image-preview:large" data-rh="true"/>',
    `<link rel="canonical" href="${url}" data-rh="true"/>`,
    '<meta property="og:type" content="profile" data-rh="true"/>',
    `<meta property="og:site_name" content="${escapeHtml(publicSiteName())}" data-rh="true"/>`,
    `<meta property="og:title" content="${escapeHtml(company.name)}" data-rh="true"/>`,
    `<meta property="og:description" content="${escapeHtml(description)}" data-rh="true"/>`,
    `<meta property="og:url" content="${url}" data-rh="true"/>`,
    `<meta property="og:image" content="${escapeHtml(image)}" data-rh="true"/>`,
    `<meta name="twitter:card" content="${banner ? 'summary_large_image' : 'summary'}" data-rh="true"/>`,
    `<script type="application/ld+json" data-rh="true">${jsonLd(schema)}</script>`,
  ].join('');
  const link = 'color:#CBB9FF';
  // Removed by the public profile once the live profile has rendered.
  const body = `<article id="gling-static-company" lang="ko" style="max-width:640px;margin:24px auto;padding:20px;color:#F6F3F0;font:16px/1.6 system-ui,sans-serif">`
    + `<p style="margin:0 0 8px;color:#CBB9FF;font-size:13px;font-weight:700">${escapeHtml([company.industry, company.city_name].filter(Boolean).join(' · '))}</p>`
    + `<h1 style="margin:0;font-size:24px;line-height:1.35">${escapeHtml(company.name)}</h1>`
    + (intro ? `<p style="margin:16px 0 0;white-space:pre-line">${escapeHtml(intro)}</p>` : '')
    + (company.address ? `<p style="margin:12px 0 0">주소: ${escapeHtml(company.address)}</p>` : '')
    + (company.business_hours ? `<p style="margin:12px 0 0;white-space:pre-line">영업시간: ${escapeHtml(company.business_hours)}</p>` : '')
    + (company.reviewCount > 0 && company.ratingAverage ? `<p style="margin:12px 0 0">영수증 인증 후기 ${company.reviewCount}개 · ${(Math.round(company.ratingAverage * 10) / 10).toFixed(1)} / 10</p>` : '')
    + `<p style="margin:16px 0 0"><a href="/${escapeHtml(company.city_id)}" style="${link}">${escapeHtml(company.city_name)} 동네 이야기 더 보기</a> · <a href="/business" style="${link}">글링에 비즈니스 등록하기</a></p>`
    + '</article>';
  return withStaticPage(template, head, body);
}

export async function prerenderPublicCompanies(directory, options) {
  const companies = await loadPublicCompanies(options);
  // Same 404 shell the posts use; the client reader already renders /company/:id from the path.
  const template = readFileSync(join(directory, '+not-found.html'), 'utf8');
  mkdirSync(join(directory, 'company'), { recursive: true });
  for (const company of companies) writeFileSync(join(directory, 'company', `${company.id}.html`), renderPublicCompany(template, company));
  return companies;
}
