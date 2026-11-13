import type { Metadata } from 'expo-router/server';
import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/app/checkin.web';

// Each check-in link carries a one-time code for one meetup: never index it.
export function generateMetadata(): Metadata {
  return { ...publicMetadata('글링 모임 체크인', '모임장 폰에 뜬 QR로 글링 앱에서 체크인해요.', `${PUBLIC_SITE}/checkin`), robots: 'noindex, nofollow' };
}
