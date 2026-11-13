import { publicMetadata } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/business';

export function generateMetadata() {
  const value = publicMetadata('글링 비즈니스 · 광고비 없이 새 손님이 찾아오는 가게',
    '한국 음식과 한국 가게를 찾는 밴쿠버·토론토·몬트리올 손님이 글링에서 가게를 봐요. 무료로 등록하고 영수증 인증 후기에 답글을 달거나, 웹에서 소식과 채용 글을 올려 보세요. 요금제도 같이 볼 수 있어요.',
    `${PUBLIC_SITE}/business`);
  const image = `${PUBLIC_SITE}/share-covers/business.png`;
  return { ...value, openGraph: { ...value.openGraph, images: [{ url: image, width: 1200, height: 630, alt: '글링 비즈니스' }] }, twitter: { ...value.twitter, images: [image] } };
}
