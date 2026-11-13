import { publicCompanyUrl, publicPostUrl } from './public-seo.ts';

// What the build knows about a public post (scripts/prerender-public-posts.mjs).
export type JobPostingFacts = {
  id: string; preview?: string | null; previewFull?: boolean; createdAt?: string | null; author?: string | null; tagSlug?: string | null;
  businessId?: string | null; businessAddress?: string | null; listingStatus?: string | null; expiresAt?: string | null;
};

// The business profile address as owners type it: "1046A Austin Ave, Coquitlam, BC V3K 3P3, Canada".
const ADDRESS = /^(.+),\s*([^,]+?),\s*(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)(?:\s+([A-Z]\d[A-Z] ?\d[A-Z]\d))?(?:,\s*Canada)?$/;
// Business job posts open with a summary line: "구인 · 서버 · 파트타임 · 다운타운".
const role = (text: string) => text.match(/^구인 · ([^·\n]+?) ·/)?.[1].trim() || null;

// Why a post carries no JobPosting (null when it does). Google wants the whole posting on the page and no filled or expired ones:
// https://developers.google.com/search/docs/appearance/structured-data/job-posting#content-policies
export function jobPostingSkip(post: JobPostingFacts, now = Date.now()) {
  if (post.tagSlug !== 'jobs' || !post.businessId) return 'not-business-job';
  if (post.previewFull !== true || !post.preview?.trim()) return 'not-full';
  // Older job posts were stories, which never close or expire.
  if (!post.listingStatus) return 'no-expiry';
  if (post.listingStatus !== 'open' && post.listingStatus !== 'partial') return 'closed';
  if (!(Date.parse(post.expiresAt ?? '') > now)) return 'expired';
  if (!role(post.preview) || !post.author?.trim() || !Number.isFinite(Date.parse(post.createdAt ?? ''))) return 'missing-fields';
  // A business that has not agreed yet shows no address, so it stays out until it does.
  if (!ADDRESS.test(post.businessAddress?.trim() ?? '')) return 'no-address';
  return null;
}

// Only an hourly wage stated on the 급여 line ("시급 $17.95", "시급 $18~22", "시급 $20부터"), with no other amount on that line.
function hourlyWage(text: string) {
  const line = text.split('\n').find(item => /^·?\s*급여\s*:/.test(item));
  const match = line?.match(/시급\s*\$(\d+(?:\.\d{1,2})?)(?:\s*[~–-]\s*\$?(\d+(?:\.\d{1,2})?))?(\s*(?:부터|이상))?/);
  if (!line || !match || line.replace(match[0], '').includes('$')) return null;
  const low = Number(match[1]), high = match[2] ? Number(match[2]) : null;
  if (high !== null && !(high > low)) return null;
  const value = high !== null ? { minValue: low, maxValue: high } : match[3] ? { minValue: low } : { value: low };
  return { '@type': 'MonetaryAmount', currency: 'CAD', value: { '@type': 'QuantitativeValue', ...value, unitText: 'HOUR' } };
}

// A separate @graph node for business job posts whose whole text is on the page; the description is that visible text.
export function publicJobPosting(post: JobPostingFacts, now = Date.now()) {
  if (jobPostingSkip(post, now)) return null;
  const text = post.preview!, url = publicPostUrl(post.id);
  const [, street, locality, region, postalCode] = post.businessAddress!.trim().match(ADDRESS)!;
  const types = [/풀타임|full[- ]?time/i.test(text) && 'FULL_TIME', /파트타임|part[- ]?time/i.test(text) && 'PART_TIME'].filter(Boolean);
  const wage = hourlyWage(text);
  return {
    '@type': 'JobPosting', '@id': `${url}#job`, url, title: role(text), description: text,
    datePosted: new Date(post.createdAt!).toISOString(), validThrough: new Date(post.expiresAt!).toISOString(),
    hiringOrganization: { '@type': 'Organization', name: post.author!.trim(), sameAs: publicCompanyUrl(post.businessId!) },
    jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', streetAddress: street.trim(), addressLocality: locality.trim(),
      addressRegion: region, ...(postalCode ? { postalCode } : {}), addressCountry: 'CA' } },
    ...(types.length ? { employmentType: types } : {}), ...(wage ? { baseSalary: wage } : {}),
  };
}
