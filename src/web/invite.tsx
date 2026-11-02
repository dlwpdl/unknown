import type { Metadata } from 'expo-router/server';
import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/app/invite.web';

// Shared invite links (/invite?code=…) need a share preview, but each one carries a personal code: keep them out of search.
export function generateMetadata(): Metadata {
  return { ...publicMetadata('친구가 글링에 초대했어요',
    '밴쿠버·토론토·몬트리올 한인이 동네 이야기를 나누고 모임을 찾는 앱이에요. 링크를 열면 초대 코드와 앱 설치 버튼이 나와요.',
    `${PUBLIC_SITE}/invite`), robots: 'noindex, follow' };
}
