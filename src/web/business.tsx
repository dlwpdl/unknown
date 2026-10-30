import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/business';

export function generateMetadata() {
  const value = publicMetadata('글링 비즈니스 등록 · 캐나다 한인 고객에게 가게 알리기',
    '밴쿠버·토론토·몬트리올 한인이 모이는 글링에 비즈니스를 무료로 등록하세요. 영수증 인증 후기에 답글을 달고, 웹에서 소식과 채용 글을 올릴 수 있어요. 요금제도 확인하세요.',
    `${PUBLIC_SITE}/business`);
  const image = `${PUBLIC_SITE}/share-covers/business.png`;
  return { ...value, openGraph: { ...value.openGraph, images: [{ url: image, width: 1200, height: 630, alt: '글링 비즈니스' }] }, twitter: { ...value.twitter, images: [image] } };
}
