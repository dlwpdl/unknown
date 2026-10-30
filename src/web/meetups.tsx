import { publicMetadata, publicReaderDescription } from '@/components/public-web/metadata';
import { PUBLIC_SITE } from '@/lib/public-seo';

export { default } from '@/components/public-web/reader';

export function generateMetadata() {
  return publicMetadata('캐나다 한인 모임 · 밴쿠버·토론토·몬트리올 | 글링', publicReaderDescription, `${PUBLIC_SITE}/meetups`);
}
