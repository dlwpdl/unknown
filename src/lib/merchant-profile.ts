import type { SupabaseClient } from '@supabase/supabase-js';
import { attachSignedPostImages, mapPublicFeed, type PublicFeedRow } from './feed-data.ts';
import type { Post } from './types.ts';
import { safeMerchantSourceUrl } from './merchant-source.ts';

export type MerchantProfile = {
  id: string; name: string; city_id: string; city_name: string;
  industry: string; services: string; address: string;
  avatar_path: string | null; banner_path: string | null; review_post_id: string | null;
  avatarUri: string | null; bannerUri: string | null; imageLoadFailed: boolean;
  links?: { url: string; label: string }[];
};

export async function attachMerchantProfileImages<T extends Pick<MerchantProfile, 'avatar_path' | 'banner_path'>>(client: SupabaseClient, profile: T) {
  const paths = [...new Set([profile.avatar_path, profile.banner_path].filter((path): path is string => !!path))];
  const urls = new Map<string, string>();
  if (paths.length) {
    try {
      const result = await client.storage.from('merchant-profile-images').createSignedUrls(paths, 3600);
      if (!result.error) for (const row of result.data ?? []) if (row.path && row.signedUrl) urls.set(row.path, row.signedUrl);
    } catch { /* A failed photo read must preserve the saved profile paths. */ }
  }
  return { ...profile, avatarUri: urls.get(profile.avatar_path ?? '') ?? null, bannerUri: urls.get(profile.banner_path ?? '') ?? null,
    imageLoadFailed: paths.some((path) => !urls.has(path)) };
}

export async function loadMerchantProfile(client: SupabaseClient, merchantId: string): Promise<MerchantProfile | null> {
  const result = await client.rpc('get_merchant_profile', { p_merchant_id: merchantId });
  if (result.error) throw new Error(result.error.message);
  if (result.data == null) return null;
  if (result.data.id !== merchantId) throw new Error('MERCHANT_PROFILE_READ_FAILED');
  const urls = Array.isArray(result.data.source_urls) ? result.data.source_urls : [];
  const safe = urls.flatMap((value: unknown) => {
    const url = typeof value === 'string' ? safeMerchantSourceUrl(value) : null;
    return url ? [url] : [];
  });
  const links = [...new Set<string>(safe)].map(url => {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return { url, label: host === 'instagram.com' ? 'Instagram' : host };
  });
  return attachMerchantProfileImages(client, { ...result.data, links } as MerchantProfile);
}

export type MerchantProfilePostKind = 'posts' | 'jobs';
export type MerchantProfilePostPage = {
  merchant_id: string; kind: MerchantProfilePostKind; post_count: number; job_count: number;
  posts: Post[]; has_more: boolean; nextOffset: number;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function loadMerchantProfilePosts(client: SupabaseClient, merchantId: string, kind: MerchantProfilePostKind = 'posts', offset = 0, viewerScope?: string): Promise<MerchantProfilePostPage | null> {
  if (!UUID.test(merchantId) || !['posts', 'jobs'].includes(kind) || !Number.isInteger(offset) || offset < 0 || offset > 10000) throw new Error('INVALID_MERCHANT_POST_PAGE');
  const result = await client.rpc('get_merchant_profile_posts', { p_merchant_id: merchantId, p_kind: kind, p_offset: offset });
  if (result.error) throw new Error(result.error.message);
  const page = result.data;
  if (page == null) return null;
  if (page.merchant_id !== merchantId || page.kind !== kind || !Number.isSafeInteger(page.post_count) || page.post_count < 0
    || !Number.isSafeInteger(page.job_count) || page.job_count < 0 || typeof page.has_more !== 'boolean' || !Array.isArray(page.posts)
    || page.posts.length > 20 || page.posts.some((row: PublicFeedRow) => !row || !UUID.test(row.id) || (row.tag_slug === 'jobs') !== (kind === 'jobs'))) throw new Error('MERCHANT_POSTS_READ_FAILED');
  const posts = await attachSignedPostImages(client, mapPublicFeed(page.posts, []), viewerScope);
  return { merchant_id: merchantId, kind, post_count: page.post_count, job_count: page.job_count, posts,
    has_more: page.has_more && posts.length > 0, nextOffset: offset + page.posts.length };
}
