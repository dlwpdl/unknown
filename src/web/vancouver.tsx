import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata('밴쿠버 한인 커뮤니티 · 동네 이야기와 모임 | 글링',
    '밴쿠버에 사는 한인들이 나누는 동네 이야기, 맛집, 렌트·구인·중고, 소모임을 글링에서 둘러보세요. 미리보기는 바로 보고, 로그인하면 전체 글을 읽을 수 있어요.',
    `${PUBLIC_SITE}/vancouver`);
}
